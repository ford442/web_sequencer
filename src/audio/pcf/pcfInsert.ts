/**
 * PCF nodes in the patch bay: the master PCF (`masterPcf`) and PCFs the user
 * places (`pcf`), with live knobs, a pattern, master-lane following and the
 * openrb low-pass mode.
 *
 * A {@link PcfInsert} is one PCF stage in a compiled graph:
 *
 * ```
 * input ─┬─ PcfEffect (pattern PCF, `rbj` mode) ─── level ─┬─ output
 *        └─ openrb branch (ReBirth PCF low-pass) ── level ─┘
 * ```
 *
 * The two branches sit behind a {@link LowpassModeSwitch}, the same A/B switch
 * the patch bay's low-pass nodes use, so the mode changes live with a 20 ms
 * crossfade. openrb mode is ReBirth's PCF low-pass at the node's cutoff and
 * resonance knobs with its envelope at rest (openrb338.wasm exports no pattern
 * envelope), so:
 *
 * - The pattern and the `pcf*` automation lanes modulate the standard branch.
 *   In openrb mode the node plays a static ReBirth low-pass that follows the
 *   knobs. Offline renders do the same, so they play what you hear.
 * - openrb is a low-pass: a node in band-pass or high-pass holds the standard
 *   branch, and so does a node that is switched off (openrb would otherwise
 *   filter a PCF that is meant to be transparent).
 *
 * The host builds inserts (they wrap AudioWorklets), through the compiler's
 * `createMasterPcf` / `createPcfNode` options. Live inserts are registered here
 * so the transport and the master lanes reach them; offline ones are not.
 *
 * See docs/audio-engine/pcf-node.md.
 */

import { PcfEffect, type PcfInitOptions } from '../../engines/PcfEffect';
import type { PcfSettings } from '../../importers/rbs/types';
import {
    LowpassModeSwitch,
    normalizeLowpassMode,
    type LowpassFilterMode,
    type LowpassModeStatus,
    type OpenrbLowpassBranch,
    type OpenrbLowpassProvider,
} from '../graph/lowpassMode';
import type { GraphNodeId, GraphPortPair, PcfNodeConfig } from '../graph/types';
import {
    PCF_OPENRB_BYPASSED,
    PCF_OPENRB_LOWPASS_ONLY,
    normalizePcfNodeConfig,
    normalizePcfPattern,
    pcfKnobToHz,
    pcfKnobToQ,
    type PcfKnobs,
    type PcfNodeEdit,
    type PcfNodeState,
} from './pcfNodeConfig';

export * from './pcfNodeConfig';

/** What the compiler asks the host for: one PCF node. */
export interface PcfNodeRequest {
    nodeId: GraphNodeId;
    config: PcfNodeConfig;
}

/** Builds a PCF node's ports (`ports.pcf` set), or `null` to bridge it. */
export type PcfNodeProvider = (context: BaseAudioContext, request: PcfNodeRequest) => GraphPortPair | null;

/** The automation-override surface the scheduler and lane watcher drive. */
export interface PcfLaneTarget {
    setAutomationCutoff(cutoffHz: number | undefined): void;
    setAutomationResonance(resonanceMidi: number | null | undefined): void;
    setAutomationEnvAmount(envAmountNorm: number | null | undefined): void;
}

export interface PcfInsertOptions {
    nodeId: GraphNodeId;
    /** The master PCF: its effect is owned by the engine lifecycle, not the insert. */
    master?: boolean;
    filterMode?: LowpassFilterMode;
    followMasterLanes?: boolean;
}

export class PcfInsert implements PcfLaneTarget {
    readonly nodeId: GraphNodeId;
    readonly master: boolean;
    readonly effect: PcfEffect;
    readonly modeSwitch: LowpassModeSwitch;
    private follow: boolean;
    private readonly openrb: OpenrbLowpassBranch | null;
    private readonly stopWatching: () => void;
    private disposed = false;

    constructor(
        context: BaseAudioContext,
        effect: PcfEffect,
        options: PcfInsertOptions,
        openrb: OpenrbLowpassBranch | null,
    ) {
        this.nodeId = options.nodeId;
        this.master = options.master === true;
        this.effect = effect;
        this.follow = options.followMasterLanes === true;
        this.openrb = openrb;
        this.modeSwitch = new LowpassModeSwitch(
            context,
            { input: effect.input, output: effect.output },
            openrb,
            normalizeLowpassMode(options.filterMode),
        );
        // Song loads drive the master's effect directly (`applyPcfFilterToEffect`),
        // so follow the effect rather than only this insert's own edits.
        this.stopWatching = effect.subscribe(() => this.sync());
        this.sync();
    }

    get input(): AudioNode {
        return this.modeSwitch.input;
    }

    get output(): AudioNode {
        return this.modeSwitch.output;
    }

    get followsMasterLanes(): boolean {
        return this.follow;
    }

    /** The port pair the compiler wires. */
    ports(): GraphPortPair {
        return { input: this.input, output: this.output, pcf: this };
    }

    knobs(): PcfKnobs {
        return this.effect.params;
    }

    pattern(): number[] {
        return this.effect.pattern;
    }

    status(): LowpassModeStatus {
        return this.modeSwitch.status();
    }

    state(): PcfNodeState {
        return {
            nodeId: this.nodeId,
            master: this.master,
            live: true,
            knobs: this.knobs(),
            pattern: this.pattern(),
            followMasterLanes: this.follow,
            mode: this.status(),
        };
    }

    /** Apply any subset of the node's settings, live. */
    edit(edit: PcfNodeEdit): PcfNodeState {
        const { pattern, followMasterLanes, filterMode, ...knobs } = edit;
        if (Object.keys(knobs).length > 0) this.effect.setParams(knobs);
        if (pattern !== undefined) {
            const safe = normalizePcfPattern(pattern);
            if (safe) this.effect.setPattern(safe);
        }
        if (followMasterLanes !== undefined) this.setFollowMasterLanes(followMasterLanes);
        if (filterMode !== undefined) this.modeSwitch.setMode(normalizeLowpassMode(filterMode));
        this.sync();
        return this.state();
    }

    /**
     * Follow (or stop following) the master `pcf*` lanes. Stopping clears the
     * overrides the lanes left, so the node returns to its own knobs.
     */
    setFollowMasterLanes(follow: boolean): void {
        if (this.master || follow === this.follow) return;
        this.follow = follow;
        if (!follow) this.clearAutomation();
    }

    setTransport(playing: boolean, bpm: number, stepIndex?: number): void {
        this.effect.setTransport(playing, bpm, stepIndex);
    }

    setAutomationCutoff(cutoffHz: number | undefined): void {
        this.effect.setAutomationCutoff(cutoffHz);
    }

    setAutomationResonance(resonanceMidi: number | null | undefined): void {
        this.effect.setAutomationResonance(resonanceMidi);
    }

    setAutomationEnvAmount(envAmountNorm: number | null | undefined): void {
        this.effect.setAutomationEnvAmount(envAmountNorm);
    }

    clearAutomation(): void {
        this.effect.setAutomationCutoff(undefined);
        this.effect.setAutomationResonance(null);
        this.effect.setAutomationEnvAmount(null);
    }

    /** Retune the openrb branch to the knobs and hold it when it cannot apply. */
    private sync(): void {
        if (this.disposed) return;
        const knobs = this.effect.params;
        this.openrb?.set?.({ cutoffHz: pcfKnobToHz(knobs.cutoff), q: pcfKnobToQ(knobs.resonance) });
        this.modeSwitch.hold(
            knobs.filterType !== 'lp' ? PCF_OPENRB_LOWPASS_ONLY : !knobs.enabled ? PCF_OPENRB_BYPASSED : null,
        );
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.stopWatching();
        this.modeSwitch.dispose();
        unregisterPcfInsert(this);
        // The master's effect outlives a recompile; the lifecycle disposes it.
        if (!this.master) this.effect.dispose();
    }
}

// ─── Live registry: transport and master lanes ──────────────────────────────

const live = new Set<PcfInsert>();
let lastTransport: { playing: boolean; bpm: number } | null = null;

export function registerPcfInsert(insert: PcfInsert): void {
    live.add(insert);
    if (lastTransport && !insert.master) {
        insert.setTransport(lastTransport.playing, lastTransport.bpm, lastTransport.playing ? 0 : undefined);
    }
}

export function unregisterPcfInsert(insert: PcfInsert): void {
    live.delete(insert);
}

/** The live PCF inserts (master included). */
export function livePcfInserts(): readonly PcfInsert[] {
    return [...live];
}

/** Dispose every live insert (engine teardown). */
export function disposeLivePcfInserts(): void {
    for (const insert of [...live]) insert.dispose();
    live.clear();
    lastTransport = null;
}

/**
 * Keep every PCF's pattern in tempo: the master's effect and each placed PCF.
 * `stepIndex` restarts the patterns (play from the top).
 */
export function broadcastPcfTransport(
    master: Pick<PcfEffect, 'setTransport'> | null,
    playing: boolean,
    bpm: number,
    stepIndex?: number,
): void {
    lastTransport = { playing, bpm };
    master?.setTransport(playing, bpm, stepIndex);
    for (const insert of live) {
        if (!insert.master) insert.setTransport(playing, bpm, stepIndex);
    }
}

/**
 * The target master `pcf*` lanes drive: the master PCF, plus every placed PCF
 * that follows the master lanes (read at call time, so a node that starts or
 * stops following is picked up on the next lane value).
 */
export function pcfLaneFanout(master: PcfLaneTarget): PcfLaneTarget {
    const followers = () => [...live].filter((insert) => !insert.master && insert.followsMasterLanes);
    return {
        setAutomationCutoff(cutoffHz) {
            master.setAutomationCutoff(cutoffHz);
            for (const insert of followers()) insert.setAutomationCutoff(cutoffHz);
        },
        setAutomationResonance(resonanceMidi) {
            master.setAutomationResonance(resonanceMidi);
            for (const insert of followers()) insert.setAutomationResonance(resonanceMidi);
        },
        setAutomationEnvAmount(envAmountNorm) {
            master.setAutomationEnvAmount(envAmountNorm);
            for (const insert of followers()) insert.setAutomationEnvAmount(envAmountNorm);
        },
    };
}

// ─── Host providers ─────────────────────────────────────────────────────────

function openrbBranchFor(
    openrb: OpenrbLowpassProvider | null | undefined,
    context: BaseAudioContext,
    nodeId: GraphNodeId,
    knobs: Pick<PcfKnobs, 'cutoff' | 'resonance'>,
): OpenrbLowpassBranch | null {
    return openrb?.(context, { nodeId, frequency: pcfKnobToHz(knobs.cutoff), Q: pcfKnobToQ(knobs.resonance) }) ?? null;
}

export interface PcfProviderOptions {
    /** openrb branch provider; `null` keeps every node on the pattern PCF. */
    openrb?: OpenrbLowpassProvider | null;
    /** Register the inserts for the transport and the master lanes (live only). */
    register?: boolean;
}

export interface PcfNodeProviderOptions extends PcfProviderOptions {
    /** Init options per node (offline: transport and the pre-timed lanes). */
    init?: (request: PcfNodeRequest, config: Required<PcfNodeConfig>) => PcfInitOptions;
    /** Collects each node's worklet init, for a caller that must wait (offline). */
    pending?: Promise<void>[];
}

/** Settings a placed PCF loads; it filters whatever is cabled through it. */
function nodeSettings(config: Required<PcfNodeConfig>): PcfSettings {
    return {
        enabled: config.enabled,
        filterType: config.filterType,
        cutoff: config.cutoff,
        resonance: config.resonance,
        envAmount: config.envAmount,
        decay: config.decay,
        pattern: [...config.pattern],
        target: { tb303A: true, tb303B: true, drums: true },
    };
}

/**
 * The compiler's `createPcfNode`: a fresh `PcfEffect` per placed PCF. The
 * effect passes audio straight through until its worklet loads, so the ports
 * are usable at once; a worklet that fails leaves the node transparent.
 */
export function createPcfNodeProvider(options: PcfNodeProviderOptions = {}): PcfNodeProvider {
    return (context, request) => {
        if (!context.audioWorklet) return null;
        const config = normalizePcfNodeConfig(request.config);
        const effect = new PcfEffect(context);
        // Settings before init: they travel as the processor's initial state.
        effect.loadSettings(nodeSettings(config));
        const ready = effect.init(options.init?.(request, config) ?? {}).catch((error: unknown) => {
            console.warn(`[pcfInsert] ${request.nodeId}: PCF worklet unavailable; the node passes audio through:`, error);
        });
        options.pending?.push(ready);
        const insert = new PcfInsert(
            context,
            effect,
            { nodeId: request.nodeId, filterMode: config.filterMode, followMasterLanes: config.followMasterLanes },
            openrbBranchFor(options.openrb, context, request.nodeId, config),
        );
        if (options.register) registerPcfInsert(insert);
        return insert.ports();
    };
}

/**
 * The compiler's `createMasterPcf`: wraps the engine's master `PcfEffect` in an
 * insert (for the mode switch and the patch bay's knobs); `null` bridges the
 * stage when the master PCF did not load.
 */
export function createMasterPcfProvider(
    effect: PcfEffect | null,
    options: PcfProviderOptions = {},
): PcfNodeProvider {
    return (context, request) => {
        if (!effect) return null;
        const config = (request.config ?? {}) as PcfNodeConfig;
        const insert = new PcfInsert(
            context,
            effect,
            { nodeId: request.nodeId, master: true, filterMode: config.filterMode },
            openrbBranchFor(options.openrb, context, request.nodeId, effect.params),
        );
        if (options.register) registerPcfInsert(insert);
        return insert.ports();
    };
}
