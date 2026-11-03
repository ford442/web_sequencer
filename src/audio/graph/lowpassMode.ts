/**
 * Low-pass filter modes for patch-bay `biquadFilter` nodes of type `lowpass`.
 *
 * | Mode | What runs |
 * |------|-----------|
 * | `rbj` (default) | The browser's `BiquadFilterNode` — the RBJ Audio EQ Cookbook low-pass. |
 * | `openrb` | ReBirth 2.01's PCF low-pass from the optional openrb338.wasm module (bit-exact at 44.1 kHz). |
 *
 * A low-pass node compiles to a {@link LowpassModeSwitch}: both filters in
 * parallel behind two level gains, so the mode is an A/B switch that changes
 * live (a 20 ms crossfade) without recompiling the patch. The openrb branch
 * exists only when the host supplies one (the module loaded); otherwise the
 * switch keeps the RBJ branch audible whatever mode is requested, and says so
 * through {@link LowpassModeSwitch.status}.
 *
 * See docs/audio-engine/openrb-lowpass.md.
 */

import type { BiquadFilterConfig, GraphNodeId, GraphNodeSpec } from './types';

export type LowpassFilterMode = 'rbj' | 'openrb';

export const LOWPASS_FILTER_MODES: readonly LowpassFilterMode[] = ['rbj', 'openrb'];

export const LOWPASS_MODE_LABELS: Readonly<Record<LowpassFilterMode, string>> = {
    rbj: 'Standard (RBJ)',
    openrb: 'openrb / ReBirth',
};

/** A stored mode, sanitized: anything but `'openrb'` is the default. */
export function normalizeLowpassMode(mode: unknown): LowpassFilterMode {
    return mode === 'openrb' ? 'openrb' : 'rbj';
}

/**
 * True for nodes that take a mode: every `lowpass` biquad the user placed, and
 * any `lowpass` biquad whose config names a mode. Fixed preset filters without
 * one stay plain biquads, so the stock patch compiles exactly as before.
 */
export function isModalLowpass(spec: Pick<GraphNodeSpec, 'factory' | 'config' | 'fixed'>): boolean {
    if (spec.factory !== 'biquadFilter') return false;
    const cfg = (spec.config ?? {}) as Partial<BiquadFilterConfig>;
    if (cfg.type !== 'lowpass') return false;
    return cfg.filterMode !== undefined || !spec.fixed;
}

/** What the host builds for the openrb branch of one node. */
export interface OpenrbLowpassRequest {
    nodeId: GraphNodeId;
    /** Cutoff in Hz and Q, as the node's config has them (the RBJ values). */
    frequency: number;
    Q: number;
}

/** The openrb branch the host supplies: an audio node plus how to steer it. */
export interface OpenrbLowpassBranch {
    node: AudioNode;
    /** Retune the branch (Hz / Q), e.g. after a config edit. */
    set?(params: { cutoffHz?: number; q?: number }): void;
    /** Called once when the branch reports it cannot run (module rejected). */
    onUnavailable?(listener: (reason: string) => void): void;
    /** True once the branch reports bit-exact output (host at 44.1 kHz). */
    bitExact?: () => boolean | null;
    dispose?(): void;
}

/** Builds the openrb branch for a node, or `null` when openrb is not available. */
export type OpenrbLowpassProvider = (
    context: BaseAudioContext,
    request: OpenrbLowpassRequest,
) => OpenrbLowpassBranch | null;

export interface LowpassModeStatus {
    /** The mode the patch asks for. */
    mode: LowpassFilterMode;
    /** The filter actually audible. */
    active: LowpassFilterMode;
    /** Whether the openrb branch exists and has not failed. */
    openrbAvailable: boolean;
    /** Why openrb is not available, when it is not. */
    reason?: string;
    /** For the openrb branch: bit-exact (44.1 kHz) or not; `null` until known. */
    bitExact: boolean | null;
}

/** Crossfade time for a live A/B switch: a hard cut between two filters clicks. */
export const LOWPASS_SWITCH_RAMP_SECONDS = 0.02;

export const OPENRB_UNAVAILABLE_REASON = 'openrb338.wasm not loaded (opt-in GPL build)';

/**
 * `input → rbj → rbjLevel → output` and `input → openrb → openrbLevel → output`;
 * exactly one level is 1.
 */
export class LowpassModeSwitch {
    readonly input: GainNode;
    readonly output: GainNode;
    readonly rbj: BiquadFilterNode;
    readonly openrb: OpenrbLowpassBranch | null;
    private readonly rbjLevel: GainNode;
    private readonly openrbLevel: GainNode | null;
    private readonly context: BaseAudioContext;
    private mode: LowpassFilterMode;
    private failure: string | null;

    constructor(
        context: BaseAudioContext,
        rbj: BiquadFilterNode,
        openrb: OpenrbLowpassBranch | null,
        mode: LowpassFilterMode,
    ) {
        this.context = context;
        this.rbj = rbj;
        this.openrb = openrb;
        this.mode = mode;
        this.failure = openrb ? null : OPENRB_UNAVAILABLE_REASON;
        this.input = context.createGain();
        this.output = context.createGain();
        this.rbjLevel = context.createGain();
        this.input.connect(rbj);
        rbj.connect(this.rbjLevel);
        this.rbjLevel.connect(this.output);
        if (openrb) {
            this.openrbLevel = context.createGain();
            this.input.connect(openrb.node);
            openrb.node.connect(this.openrbLevel);
            this.openrbLevel.connect(this.output);
            openrb.onUnavailable?.((reason) => {
                this.failure = reason;
                this.apply(0);
            });
        } else {
            this.openrbLevel = null;
        }
        this.apply(0);
    }

    /** The audible mode: openrb only when asked for and available. */
    get active(): LowpassFilterMode {
        return this.mode === 'openrb' && this.openrbLevel && this.failure === null ? 'openrb' : 'rbj';
    }

    status(): LowpassModeStatus {
        const openrbAvailable = this.openrbLevel !== null && this.failure === null;
        return {
            mode: this.mode,
            active: this.active,
            openrbAvailable,
            ...(openrbAvailable ? {} : { reason: this.failure ?? OPENRB_UNAVAILABLE_REASON }),
            bitExact: this.openrb?.bitExact?.() ?? null,
        };
    }

    /** Switch modes live, with a short crossfade. */
    setMode(mode: LowpassFilterMode, rampSeconds = LOWPASS_SWITCH_RAMP_SECONDS): LowpassModeStatus {
        this.mode = normalizeLowpassMode(mode);
        this.apply(rampSeconds);
        return this.status();
    }

    private apply(rampSeconds: number): void {
        const openrb = this.active === 'openrb';
        ramp(this.rbjLevel.gain, openrb ? 0 : 1, this.context.currentTime, rampSeconds);
        if (this.openrbLevel) ramp(this.openrbLevel.gain, openrb ? 1 : 0, this.context.currentTime, rampSeconds);
    }

    dispose(): void {
        this.openrb?.dispose?.();
    }
}

function ramp(param: AudioParam, value: number, now: number, seconds: number): void {
    if (seconds <= 0 || typeof param.linearRampToValueAtTime !== 'function') {
        param.setValueAtTime(value, now);
        return;
    }
    param.cancelScheduledValues?.(now);
    param.setValueAtTime(param.value, now);
    param.linearRampToValueAtTime(value, now + seconds);
}
