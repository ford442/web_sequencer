/**
 * LiveHighFidAbPair — Phase L2 live A/B and Phase L3 coefficient link for one
 * Open303Oscillator.
 *
 * A/B does not add a second oscillator or a second WASM instance: the part's
 * `open303-processor` already owns a custom open303 instance next to the live
 * diode ladder. While A/B is engaged the processor renders stock Open303 to
 * output 0 and the diode ladder to output 1 from the same note stream; this
 * class owns the two gains that crossfade those buses. Everything is created
 * on first engage, so a part that never arms A/B keeps the exact L1 graph
 * (`worklet output 0 → gain`), and a stock-only session pays nothing.
 */

import {
    CANONICAL_HIGHFID_COEFFICIENTS,
    HighFidCoefficientTable,
    normalizeHighFidCoefficients,
    type HighFidCoefficients,
} from '../audio-worklets/liveHighFidCoefficients';

/** Persisted A/B request for one 303 part (see `TB303VoiceExtra.ab`). */
export interface LiveAbSettings {
    /** A/B requested. Only engages while the part plays `live-highfid`. */
    armed: boolean;
    /** Equal-power blend: 0 = stock Open303 (A), 1 = live high-fid (B). */
    mix: number;
}

/**
 * Arming must not change what the user hears: they were already listening to
 * `live-highfid`, so the blend starts fully on side B.
 */
export const DEFAULT_LIVE_AB_MIX = 1;

export function clampAbMix(value: unknown): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_LIVE_AB_MIX;
    return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** Equal-power crossfade gains: stock² + highFid² = 1 at every blend. */
export function equalPowerAbGains(mix: number): { stock: number; highFid: number } {
    const m = clampAbMix(mix);
    // Snap the endpoints so a hard flip is exactly one bus, not cos(π/2) ≈ 6e-17.
    if (m === 0) return { stock: 1, highFid: 0 };
    if (m === 1) return { stock: 0, highFid: 1 };
    const theta = m * (Math.PI / 2);
    return { stock: Math.cos(theta), highFid: Math.sin(theta) };
}

/**
 * Which side a freeze / capture of an A/B track records. #1235 (offline graph
 * compiler) is the only thing that could render a blend, so until it exists
 * a freeze takes one side: high-fid at mix ≥ 0.5, stock below.
 */
export function abFreezeSide(mix: number): 'stock' | 'highfid' {
    return clampAbMix(mix) >= 0.5 ? 'highfid' : 'stock';
}

export class LiveHighFidAbPair {
    private readonly context: BaseAudioContext;
    private readonly worklet: AudioWorkletNode;
    private readonly destination: AudioNode;
    private gainA: GainNode | null = null;
    private gainB: GainNode | null = null;
    private engaged = false;
    private mix = DEFAULT_LIVE_AB_MIX;

    constructor(context: BaseAudioContext, worklet: AudioWorkletNode, destination: AudioNode) {
        this.context = context;
        this.worklet = worklet;
        this.destination = destination;
    }

    get isEngaged(): boolean {
        return this.engaged;
    }

    get currentMix(): number {
        return this.mix;
    }

    /**
     * Route output 0 → gain A and output 1 → gain B, then tell the worklet.
     * A no-op while engaged: blend changes go through {@link setMix}, which
     * honours their audio time (re-applying here would pull a scheduled
     * automation point forward to `currentTime`).
     */
    engage(mix: number): void {
        if (this.engaged) return;
        this.mix = clampAbMix(mix);
        if (!this.gainA || !this.gainB) {
            this.gainA = this.context.createGain();
            this.gainB = this.context.createGain();
            this.gainA.connect(this.destination);
            this.gainB.connect(this.destination);
        }
        this.applyGains(this.context.currentTime);
        this.worklet.disconnect();
        this.worklet.connect(this.gainA, 0);
        this.worklet.connect(this.gainB, 1);
        this.engaged = true;
        this.worklet.port.postMessage({ type: 'set-live-ab', data: { armed: true } });
    }

    /** Back to the L1 graph: output 0 straight into the destination. */
    release(): void {
        if (!this.engaged) return;
        this.engaged = false;
        this.worklet.disconnect();
        this.worklet.connect(this.destination);
        this.worklet.port.postMessage({ type: 'set-live-ab', data: { armed: false } });
    }

    /**
     * Blend change, scheduled on the audio clock (automation lanes pass the
     * step's time). Stored while released so the next engage uses it.
     */
    setMix(mix: number, audioTime?: number): void {
        this.mix = clampAbMix(mix);
        if (!this.engaged) return;
        this.applyGains(Math.max(this.context.currentTime, audioTime ?? 0));
    }

    dispose(): void {
        this.engaged = false;
        this.gainA?.disconnect();
        this.gainB?.disconnect();
        this.gainA = null;
        this.gainB = null;
    }

    private applyGains(time: number): void {
        const { stock, highFid } = equalPowerAbGains(this.mix);
        this.gainA?.gain.setValueAtTime(stock, time);
        this.gainB?.gain.setValueAtTime(highFid, time);
    }
}

/**
 * Delivers diode-ladder coefficients to one worklet: through a shared table
 * when the page is crossOriginIsolated (knob moves never post a message),
 * otherwise as `set-highfid-coeffs` messages.
 */
export class LiveHighFidCoefficientLink {
    private readonly port: MessagePort;
    private readonly table: HighFidCoefficientTable | null;

    constructor(port: MessagePort, table: HighFidCoefficientTable | null = HighFidCoefficientTable.create()) {
        this.port = port;
        this.table = table;
        if (table) {
            port.postMessage({ type: 'attach-highfid-coeff-table', data: { buffer: table.buffer } });
        }
    }

    get usesSharedTable(): boolean {
        return this.table !== null;
    }

    send(coefficients: HighFidCoefficients): void {
        if (this.table) {
            this.table.write(coefficients);
        } else {
            this.port.postMessage({ type: 'set-highfid-coeffs', data: { coefficients: { ...coefficients } } });
        }
    }
}

/** What the controller needs from its Open303Oscillator, read on every sync. */
export interface LiveHighFidHost {
    context: BaseAudioContext | null;
    worklet: AudioWorkletNode | null;
    /** Where output 0 goes on the L1 graph (the oscillator's gain node). */
    destination: AudioNode | null;
    /** The part plays `live-highfid` on the worklet (not the JS fallback). */
    liveHighFidSelected: boolean;
}

/**
 * Per-oscillator L2/L3 state: the A/B request, the lazily created crossfade
 * pair and the coefficient link. Open303Oscillator delegates to this and calls
 * {@link sync} whenever its model, worklet or fallback state changes.
 */
export class LiveHighFidVoiceControls {
    private readonly host: () => LiveHighFidHost;
    private ab: LiveAbSettings = { armed: false, mix: DEFAULT_LIVE_AB_MIX };
    private pair: LiveHighFidAbPair | null = null;
    private coefficients: HighFidCoefficients | undefined;
    private link: LiveHighFidCoefficientLink | null = null;
    private readonly onAbChange?: (state: LiveAbSettings & { engaged: boolean }) => void;
    /** Last state handed to onAbChange — idle re-syncs must not clobber other parts. */
    private lastReported = '';

    constructor(
        host: () => LiveHighFidHost,
        onAbChange?: (state: LiveAbSettings & { engaged: boolean }) => void,
    ) {
        this.host = host;
        this.onAbChange = onAbChange;
    }

    get liveAb(): LiveAbSettings {
        return { ...this.ab };
    }

    get isAbEngaged(): boolean {
        return this.pair?.isEngaged ?? false;
    }

    /** Store the request, then engage / release to match the host. */
    setLiveAb(settings: Partial<LiveAbSettings>, audioTime?: number): void {
        const armed = settings.armed ?? this.ab.armed;
        const mix = settings.mix === undefined ? this.ab.mix : clampAbMix(settings.mix);
        this.ab = { armed, mix };
        if (this.pair?.isEngaged) this.pair.setMix(mix, audioTime);
        this.sync();
    }

    /** Engage while armed on live-highfid, release otherwise (incl. CPU-gate step-down). */
    sync(): void {
        const { context, worklet, destination, liveHighFidSelected } = this.host();
        if (this.ab.armed && liveHighFidSelected && context && worklet && destination) {
            this.pair ??= new LiveHighFidAbPair(context, worklet, destination);
            this.pair.engage(this.ab.mix);
        } else {
            this.pair?.release();
        }
        this.reportIfChanged();
    }

    /**
     * Telemetry is one global HUD summary shared by every 303 part, so only a
     * part that is (or just stopped being) engaged may write it — an idle part
     * re-synced after a song load would otherwise wipe the engaged one.
     */
    private reportIfChanged(): void {
        const state = { ...this.ab, engaged: this.isAbEngaged };
        const key = `${state.armed}|${state.mix}|${state.engaged}`;
        const wasEngaged = this.lastReported.endsWith('|true');
        if (key === this.lastReported || (!state.engaged && !wasEngaged)) return;
        this.lastReported = key;
        this.onAbChange?.(state);
    }

    get highFidCoefficients(): HighFidCoefficients | undefined {
        return this.coefficients ? { ...this.coefficients } : undefined;
    }

    /** Song-stored coefficients; `undefined` = canonical. Morphs the running voice. */
    setHighFidCoefficients(coefficients: HighFidCoefficients | undefined): void {
        this.coefficients = normalizeHighFidCoefficients(coefficients);
        this.pushCoefficients();
    }

    pushCoefficients(): void {
        const { worklet } = this.host();
        if (!worklet) return;
        // The worklet already starts canonical: a part that never stored
        // coefficients gets no table and no message.
        if (!this.coefficients && !this.link) return;
        this.link ??= new LiveHighFidCoefficientLink(worklet.port);
        this.link.send(this.coefficients ?? CANONICAL_HIGHFID_COEFFICIENTS);
    }

    /** The worklet is going away: drop everything bound to it, keep the requests. */
    detach(): void {
        this.pair?.dispose();
        this.pair = null;
        this.link = null;
    }
}
