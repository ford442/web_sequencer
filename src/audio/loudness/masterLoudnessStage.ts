/**
 * Main-thread handle for the master loudness worklet.
 *
 * Owns the AudioWorkletNode, the throttled stats stream and the (debounced)
 * unidirectional UI → worklet parameter flow. The UI never reads audio state
 * directly: it subscribes to scalar snapshots emitted by the worklet.
 */

import { attachWorkletPerf } from '../../utils/workletPerfBridge';
import masterLoudnessProcessorUrl from '../../audio-worklets/master-loudness-processor.ts?worker&url';
import { loadLimiterSettings, saveLimiterSettings } from './settings';
import {
    DEFAULT_LIMITER_SETTINGS,
    MASTER_LOUDNESS_PROCESSOR_NAME,
    SILENCE_LUFS,
    type LimiterSettings,
    type LoudnessStats,
    type MasterLoudnessCommand,
    type MasterLoudnessReport,
} from './types';

/** Coalesce rapid knob movements into one message per animation-ish frame. */
const PARAM_DEBOUNCE_MS = 30;

export const IDLE_LOUDNESS_STATS: LoudnessStats = {
    momentary: SILENCE_LUFS,
    shortTerm: SILENCE_LUFS,
    integrated: SILENCE_LUFS,
    truePeak: SILENCE_LUFS,
    samplePeak: SILENCE_LUFS,
    gainReduction: 0,
    clipped: false,
};

export type LoudnessStatsListener = (stats: LoudnessStats) => void;

export interface MasterLoudnessStageOptions {
    /** Initial settings; defaults to the persisted ones. */
    settings?: Partial<LimiterSettings>;
    /** Persist settings changes to localStorage. Default true. */
    persist?: boolean;
}

export class MasterLoudnessStage {
    readonly node: AudioWorkletNode;
    private settings: LimiterSettings;
    private readonly listeners = new Set<LoudnessStatsListener>();
    private readonly persist: boolean;
    private pendingUpdate: Partial<LimiterSettings> | null = null;
    private debounceTimer: ReturnType<typeof setTimeout> | null = null;

    latestStats: LoudnessStats = IDLE_LOUDNESS_STATS;
    /** Lookahead latency reported by the worklet, seconds. */
    latencySeconds = 0;

    private readonly detachPerf: () => void;

    constructor(node: AudioWorkletNode, settings: LimiterSettings, persist: boolean) {
        this.node = node;
        this.detachPerf = attachWorkletPerf(node, 'masterLoudness');
        this.settings = settings;
        this.persist = persist;
        this.node.port.onmessage = (event: MessageEvent<MasterLoudnessReport>) => {
            const message = event.data;
            if (!message || message.type !== 'loudness-stats') return;
            this.latestStats = message.data;
            this.latencySeconds = message.latencySeconds;
            for (const listener of this.listeners) listener(message.data);
        };
    }

    getSettings(): LimiterSettings {
        return { ...this.settings };
    }

    /** Subscribe to scalar meter updates. Returns an unsubscribe function. */
    subscribe(listener: LoudnessStatsListener): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    /** Update limiter settings (debounced towards the audio thread). */
    update(update: Partial<LimiterSettings>): void {
        this.settings = { ...this.settings, ...update };
        this.pendingUpdate = { ...(this.pendingUpdate ?? {}), ...update };
        if (this.persist) saveLimiterSettings(this.settings);
        if (this.debounceTimer !== null) return;
        this.debounceTimer = setTimeout(() => {
            this.debounceTimer = null;
            const data = this.pendingUpdate;
            this.pendingUpdate = null;
            if (data) this.post({ type: 'set-limiter', data });
        }, PARAM_DEBOUNCE_MS);
    }

    /** Explicit user action: restart the gated integrated measurement. */
    resetLoudness(): void {
        this.latestStats = { ...this.latestStats, integrated: SILENCE_LUFS, truePeak: SILENCE_LUFS };
        this.post({ type: 'reset-loudness' });
    }

    /** Change the meter report rate (capped at 30 Hz inside the worklet). */
    setReportHz(hz: number): void {
        this.post({ type: 'set-report-hz', data: hz });
    }

    dispose(): void {
        if (this.debounceTimer !== null) {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = null;
        }
        this.listeners.clear();
        this.detachPerf();
        this.node.port.onmessage = null;
        try {
            this.node.disconnect();
        } catch {
            // Already disconnected — nothing to do.
        }
    }

    private post(command: MasterLoudnessCommand): void {
        try {
            this.node.port.postMessage(command);
        } catch {
            // A closed context must not take the UI down with it.
        }
    }
}

/**
 * Load the master loudness worklet module and build its node.
 *
 * Returns `null` when the browser cannot register the worklet, so the caller
 * can compile the graph without the limiter stage instead of failing playback.
 */
export async function createMasterLoudnessStage(
    context: BaseAudioContext,
    options: MasterLoudnessStageOptions = {},
): Promise<MasterLoudnessStage | null> {
    const persist = options.persist ?? true;
    const settings: LimiterSettings = {
        ...DEFAULT_LIMITER_SETTINGS,
        ...(persist ? loadLimiterSettings() : {}),
        ...options.settings,
    };

    try {
        await context.audioWorklet.addModule(masterLoudnessProcessorUrl);
        const node = new AudioWorkletNode(context, MASTER_LOUDNESS_PROCESSOR_NAME, {
            numberOfInputs: 1,
            numberOfOutputs: 1,
            outputChannelCount: [2],
            channelCount: 2,
            channelCountMode: 'explicit',
            processorOptions: { limiter: settings },
        });
        return new MasterLoudnessStage(node, settings, persist);
    } catch (error) {
        console.warn('[loudness] master limiter/meter worklet unavailable', error);
        return null;
    }
}
