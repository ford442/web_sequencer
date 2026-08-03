/**
 * Shared oscillator backend contract (#1034).
 *
 * Every oscillator implementation (WebGPU, AssemblyScript WASM, Rust WASM,
 * WAV/PCM, plain JS) is wrapped in an adapter implementing this interface so
 * that lifecycle code can select, probe and fall back across backends without
 * knowing anything about the concrete engine — and without `as any` readiness
 * checks.
 *
 * Two rules the contract exists to enforce:
 *   1. Readiness is typed. `isSupported` (this machine *can* run it) and
 *      `isReady` (it *is* initialized) are separate, non-optional booleans.
 *   2. A backend never silently substitutes a different waveform family.
 *      `supportsShape()` is authoritative; substitution goes through
 *      `logWaveformSubstitution` so it lands in the HUD and telemetry.
 */

import type { WaveShape } from '../../utils/waveformParser';

export type OscillatorBackendId = 'webgpu' | 'wam' | 'rust' | 'wav' | 'js';

/**
 * Ordered preference chain — best first. Selection walks this list and takes
 * the first backend that is both supported and ready. `js` is terminal: it has
 * no dependencies and is always ready, so resolution can never come up empty.
 */
export const BACKEND_FALLBACK_ORDER: readonly OscillatorBackendId[] = [
    'webgpu',
    'wam',
    'rust',
    'wav',
    'js',
] as const;

/** Human-facing labels for the HUD / degradation banner. */
export const BACKEND_LABELS: Record<OscillatorBackendId, string> = {
    webgpu: 'WebGPU',
    wam: 'AS WASM',
    rust: 'Rust WASM',
    wav: 'WAV PCM',
    js: 'JS oscillator',
};

export interface BackendCapabilities {
    /** WASM SIMD is used by the backend's DSP kernel. */
    simd: boolean;
    /** Backend can use worker/atomics threading. */
    threads: boolean;
    /** Backend can render faster-than-realtime for freeze/export. */
    offline: boolean;
    /** Simultaneous voices the backend can sustain; Infinity for graph-native. */
    polyphony: number;
    /** Waveform families the backend renders natively. */
    shapes: readonly WaveShape[];
}

export interface InitResult {
    /** Backend finished init and is usable. */
    ok: boolean;
    backendId: OscillatorBackendId;
    /** Why init failed (or a short note on success). Always set on failure. */
    reason?: string;
}

export interface GenerateRequest {
    /** Frequency in Hz of the rendered cycle/table. */
    frequency: number;
    /** Duration in seconds. */
    duration: number;
    sampleRate: number;
    shape: WaveShape;
    /** Lowpass cutoff in Hz. Backends without a filter ignore it. */
    cutoff: number;
    /** Filter resonance / Q. Backends without a filter ignore it. */
    resonance: number;
}

/**
 * Normalized surface shared by every oscillator backend.
 *
 * `generate` is the required rendering primitive — all current backends are
 * buffer producers. `noteOn`/`noteOff` are optional and implemented only by
 * backends that own realtime voices themselves (none today; the hook exists so
 * a future worklet-resident engine plugs in here rather than adding a parallel
 * entry point).
 */
export interface OscillatorBackend {
    readonly id: OscillatorBackendId;
    /** Stable display label. */
    readonly label: string;
    /** This environment can run the backend at all (feature detection). */
    readonly isSupported: boolean;
    /** Backend has completed init and `generate()` will be attempted. */
    readonly isReady: boolean;
    readonly capabilities: BackendCapabilities;

    init(ctx: AudioContext): Promise<InitResult>;
    /**
     * Render `duration` seconds. Returns null when the backend cannot service
     * the request — callers must then fall back (and log it).
     */
    generate(req: GenerateRequest): Promise<Float32Array | null>;
    /** True when the backend renders `shape` without changing wave family. */
    supportsShape(shape: WaveShape): boolean;
    dispose(): void;

    /** Optional realtime surface for backends that own their own voices. */
    noteOn?(note: number, velocity: number, when: number): void;
    noteOff?(note: number, when: number): void;
}

/** Convenience guard used by selection code — keeps the checks in one place. */
export function isBackendUsable(backend: OscillatorBackend | null | undefined): backend is OscillatorBackend {
    return !!backend && backend.isSupported && backend.isReady;
}
