/**
 * Shared oscillator backend contract (#1034), collapsed to one live basic-wave
 * story in #1294.
 *
 * THE CHOICE (see `docs/wasm/BUILD_NOTES.md#basic-wave-engines`):
 *   - `js` — `OscillatorNode` is the always-on path. Graph-native,
 *     sample-accurate, cannot fail, costs nothing to keep. It is terminal:
 *     it has no `renderLoop`, because it needs no table.
 *   - `wam` — the ONE WASM wavetable engine, `assembly/oscillators.ts`. Kept
 *     over a C++ wavetable in `hyphon_native` because it already has a
 *     validated Safari feature intersection (simd + bulk-memory, no WasmGC)
 *     and because the native heap budget is sized for voices, not tables.
 *     Named `wam` for persisted-state compatibility — it is NOT Web Audio
 *     Modules 2.0 (`src/audio/wam`, ADR 0001), and the UI calls it "WASM OSC".
 *   - `wav` / `webgpu` / `pyodide` — table producers (decoded asset, GPU
 *     pre-render, CPython pre-render). Real, but not realtime voices.
 *
 * Removed: `rust`. `rust-audio/` generated a naive saw/square + biquad on the
 * main thread and looped it — no SIMD, no worklet, and a duplicate of `wam`.
 * It is a bench crate now. Nothing may be added here that renders on the main
 * thread into an `AudioBufferSourceNode`; the import-graph guard in
 * `__tests__/oscillatorEngineContract.test.ts` enforces that.
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

export type OscillatorBackendId = 'webgpu' | 'wam' | 'pyodide' | 'wav' | 'js';

/**
 * Ordered preference chain — best first. Selection walks this list and takes
 * the first backend that is both supported and ready. `js` is terminal: it has
 * no dependencies and is always ready, so resolution can never come up empty.
 *
 * This array is the *only* fallback order in the codebase (#1294). Callers ask
 * the registry for a starting point; they never re-implement the walk.
 */
export const BACKEND_FALLBACK_ORDER: readonly OscillatorBackendId[] = [
    'webgpu',
    'wam',
    'pyodide',
    'wav',
    'js',
] as const;

/**
 * Human-facing labels for the HUD / degradation banner.
 *
 * `wam` is Hyphon's AssemblyScript wavetable kernel, NOT Web Audio Modules 2.0
 * (`src/audio/wam`, ADR 0001). The label says "WASM OSC" so the two cannot be
 * confused in the UI; the backend id stays `wam` for persisted-state
 * compatibility.
 */
export const BACKEND_LABELS: Record<OscillatorBackendId, string> = {
    webgpu: 'WebGPU',
    wam: 'WASM OSC',
    pyodide: 'Pyodide',
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

/**
 * Reference pitch of every cached wavetable (C4). The realtime path resamples
 * with `playbackRate`, so a backend that hands back a cached table reports this
 * as its `baseFrequency`.
 */
export const TABLE_REF_FREQ = 261.63;
/** Length of a cached wavetable, in seconds. */
export const TABLE_DURATION_SEC = 2.0;

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
 * A looped single-shot table plus the pitch it actually sounds at, so the
 * caller can set `playbackRate` without knowing which backend produced it.
 *
 * Returning an `AudioBuffer` (rather than samples) is deliberate: the PCM and
 * pre-rendered GPU backends hand back a cached buffer with no per-note copy,
 * which keeps the realtime note path allocation-light.
 */
export interface LoopRender {
    buffer: AudioBuffer;
    /** Frequency `buffer` sounds at when played back at rate 1.0. */
    baseFrequency: number;
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
    /**
     * Synchronous realtime path: produce a loopable table for `req` now, or
     * null when this backend cannot service it (caller falls back and logs).
     *
     * Optional because `js` has no table — it drives an `OscillatorNode`
     * directly and is therefore the terminal step of the chain.
     */
    renderLoop?(ctx: BaseAudioContext, req: GenerateRequest): LoopRender | null;
    dispose(): void;

    /** Optional realtime surface for backends that own their own voices. */
    noteOn?(note: number, velocity: number, when: number): void;
    noteOff?(note: number, when: number): void;
}

/** Convenience guard used by selection code — keeps the checks in one place. */
export function isBackendUsable(backend: OscillatorBackend | null | undefined): backend is OscillatorBackend {
    return !!backend && backend.isSupported && backend.isReady;
}
