/**
 * The master-bus PCF (ReBirth Pattern Controlled Filter).
 *
 * Graph position: the fixed `masterPcf` node of the patch bay, between
 * `masterPanner` and `masterLimiter` (see `defaultElectribeGraph.ts`). It is
 * an AudioWorklet, so like the limiter the host builds it before the graph
 * compiles and hands its ports to the compiler (`createMasterPcf`); when the
 * worklet cannot load, the compiler bridges the panner straight to the limiter
 * and the master PCF lanes stay silent, as they were before.
 *
 * Who drives it:
 * - `AutomationScheduler` sends master `pcfCutoff` / `pcfResonance` /
 *   `pcfEnvAmount` lanes (RBS import) as automation overrides. A cutoff
 *   override engages the filter even with the pattern PCF off.
 * - `applyPcfFilterToEffect` loads an imported song's `pcfFilter` (pattern PCF).
 * - The transport (`useAppState`) keeps the pattern stepping in tempo.
 * - Offline renders build their own instance (`compileOfflineGraph`, option
 *   `masterPcf`) with the lanes pre-timed on the render clock.
 */

import { PcfEffect, type PcfInitOptions } from '../../engines/PcfEffect';
import type { PcfSettings } from '../../importers/rbs/types';
import type { GraphPortPair } from '../graph/types';
import { PCF_LANE_PARAMS, isParkedPcfCutoffLane } from '../automation/laneResolver';
import { engineDegradationStore } from '../../stores/engineDegradationStore';

/** Build and initialise a PCF on `context`; `null` when the worklet cannot load. */
export async function createMasterPcf(
    context: BaseAudioContext,
    options: PcfInitOptions & { settings?: PcfSettings | null } = {},
): Promise<PcfEffect | null> {
    if (!context.audioWorklet) return null;
    const pcf = new PcfEffect(context);
    try {
        // Settings before init: they go to the processor as its initial state.
        if (options.settings) pcf.loadSettings(options.settings);
        await pcf.init(options);
        return pcf;
    } catch (error) {
        console.warn('[masterPcf] PCF worklet unavailable; master PCF lanes will not play:', error);
        reportMasterPcfUnavailable(error);
        pcf.dispose();
        return null;
    }
}

/** `engineDegradationStore` id of a master PCF that failed to load. */
export const MASTER_PCF_DEGRADATION_ID = 'master-pcf';

function errorReason(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/**
 * Put a master PCF that failed to load in front of the user (the degradation
 * banner), like every other worklet fallback. The mix still plays: the graph
 * bridges the panner straight to the limiter.
 */
function reportMasterPcfUnavailable(error: unknown): void {
    engineDegradationStore.report({
        id: MASTER_PCF_DEGRADATION_ID,
        subsystem: 'master-pcf',
        category: 'worklet',
        message: 'Master PCF unavailable: master PCF lanes and the song PCF will not play',
        reason: errorReason(error),
        status: 'active',
        activeBackend: 'bypass',
        requestedBackend: 'pcf-processor',
        retryable: false,
    });
}

/** The ports the graph compiler wires into the `masterPcf` node. */
export function masterPcfPorts(pcf: PcfEffect | null): GraphPortPair | null {
    return pcf ? { input: pcf.input, output: pcf.output } : null;
}

let current: PcfEffect | null = null;

/** Publish (or clear) the live master PCF. Called by the engine lifecycle. */
export function setMasterPcf(pcf: PcfEffect | null): void {
    current = pcf;
}

/** The live master PCF, or `null` when the engine is not running / it failed to load. */
export function getMasterPcf(): PcfEffect | null {
    return current;
}

type SongPcfFilter = NonNullable<import('../../types/song').SavedSongData['pcfFilter']>;

/**
 * The `pcfFilter` a song save writes: the song's own (imported) PCF, unless
 * the user changed the master PCF by hand in the patch bay since the song
 * loaded — then the master PCF's current state, keeping the song's per-part
 * `target` when it had one. `undefined` writes none.
 */
export function pcfFilterForSave(
    saved: SongPcfFilter | null | undefined,
    master: Pick<PcfEffect, 'edited' | 'settings'> | null | undefined,
): SongPcfFilter | undefined {
    if (!master?.edited) return saved ?? undefined;
    const settings = master.settings;
    return {
        enabled: settings.enabled,
        filterType: settings.filterType,
        cutoff: settings.cutoff,
        resonance: settings.resonance,
        envAmount: settings.envAmount,
        decay: settings.decay,
        pattern: [...settings.pattern],
        target: saved?.target ? { ...saved.target } : { ...settings.target },
    };
}

interface LaneLike {
    target: string;
    parameter: string;
    enabled?: boolean;
    points?: ReadonlyArray<{ value: number }>;
}

/**
 * Track which master PCF params have a lane, and clear the override of any
 * that lost theirs. An override otherwise outlives its lane: the last
 * automated cutoff would keep filtering the whole mix after the song that
 * automated it is replaced or its lane deleted.
 *
 * Returns the updater to feed each lane snapshot (e.g. an automation-store
 * subscription).
 */
export function createPcfLaneWatcher(pcf: Pick<PcfEffect, 'setAutomationCutoff' | 'setAutomationResonance' | 'setAutomationEnvAmount'>) {
    let active = new Set<string>();
    return (lanes: readonly LaneLike[], playbackEnabled = true): void => {
        const next = new Set<string>();
        if (playbackEnabled) {
            for (const lane of lanes) {
                if (
                    lane.target === 'master'
                    && lane.enabled !== false
                    && PCF_LANE_PARAMS.has(lane.parameter)
                    // Parked at 0 it plays as no lane (`isParkedPcfCutoffLane`), so clear its override.
                    && !isParkedPcfCutoffLane({ target: 'master', parameter: lane.parameter, points: lane.points })
                ) {
                    next.add(lane.parameter);
                }
            }
        }
        for (const parameter of active) {
            if (next.has(parameter)) continue;
            if (parameter === 'pcfCutoff') pcf.setAutomationCutoff(undefined);
            else if (parameter === 'pcfResonance') pcf.setAutomationResonance(null);
            else if (parameter === 'pcfEnvAmount') pcf.setAutomationEnvAmount(null);
        }
        active = next;
    };
}
