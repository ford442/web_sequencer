/**
 * Shared oscillator backend contract (#1034), collapsed to one live basic-wave
 * story in #1294, and reopened one family at a time by #1663.
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
 *   - `rust` — the first *worklet-resident* basic-wave engine (#1664): a
 *     no_std SIMD PolyBLEP kernel (`rust-audio/`) instantiated inside one
 *     AudioWorkletProcessor per voice. It renders no table; it hands `Voice` a
 *     live source through `acquireVoice` (see `RealtimeVoice`).
 *   - `cpp` — the second worklet-resident engine (#1665), and the first `cpp-*`
 *     renderer that ever existed: a scalar, linear-phase windowed-sinc BLEP
 *     kernel (`emscripten/cpp_osc.cpp`) in its own standalone module
 *     (`public/cpp_osc.wasm`, not `hyphon_native`), one instance per voice.
 *     It needs no WASM SIMD, so it also catches a `rust-*` part on a browser
 *     that cannot run the Rust kernel.
 *   - `dwgs` — the third worklet-resident engine (#1666), and not a basic-wave
 *     engine at all: Korg's Digital Waveform Generator System as harmonic
 *     recipes rendered additively by a scalar Rust kernel (`dwgs-audio/`,
 *     `public/dwgs_osc.wasm`), one instance per voice. Its waves are its own,
 *     so it is `entryOnly`: it serves `dwgs-*` parts and is never the fallback
 *     for another family (see `BackendCapabilities.entryOnly`).
 *   - `wav` / `webgpu` / `pyodide` — table producers (decoded asset, GPU
 *     pre-render, CPython pre-render). Real, but not realtime voices. The GPU
 *     tables are band-limited per octave and rendered in one dispatch (#1668);
 *     why WebGPU cannot be a worklet voice is in BUILD_NOTES `#wgsl-gpu`.
 *
 * What #1294 removed — `rust-audio/` generating a naive saw/square + biquad on
 * the main thread and looping it — stays removed: `rust` came back as a
 * worklet, not as that. Nothing may be added here that renders on the main
 * thread into an `AudioBufferSourceNode`; the import-graph guard in
 * `__tests__/oscillatorEngineContract.test.ts` enforces that.
 *
 * Every oscillator implementation (WebGPU, AssemblyScript WASM, Rust WASM,
 * C++ WASM, WAV/PCM, plain JS) is wrapped in an adapter implementing this interface so
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
import type { FilterType } from '../../types/synth';

export type OscillatorBackendId = 'dwgs' | 'webgpu' | 'rust' | 'cpp' | 'wam' | 'pyodide' | 'wav' | 'js';

/**
 * Ordered preference chain — best first. Selection walks this list and takes
 * the first backend that is both supported and ready. `js` is terminal: it has
 * no dependencies and is always ready, so resolution can never come up empty.
 *
 * This array is the *only* fallback order in the codebase (#1294). Callers ask
 * the registry for a starting point; they never re-implement the walk.
 *
 * `rust` and `cpp` sit above `wam`: they are the realtime, band-limited
 * voices. `cpp` is directly below `rust` because it is scalar — a `rust-*` part
 * on a browser without WASM SIMD drops to the C++ kernel (still a live,
 * band-limited voice) before the AssemblyScript table. A `cpp-*` part that
 * cannot get its worklet (no AudioWorklet, module missing) drops to the table.
 * Every step is logged; none goes straight to `OscillatorNode`.
 *
 * `dwgs` heads the list because nothing may fall *into* it — it is
 * `entryOnly` — while a `dwgs-*` part that cannot get its worklet walks the
 * whole chain below it with the wave's nearest basic shape.
 */
export const BACKEND_FALLBACK_ORDER: readonly OscillatorBackendId[] = [
    'dwgs',
    'webgpu',
    'rust',
    'cpp',
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
    dwgs: 'DWGS',
    webgpu: 'WebGPU',
    rust: 'Rust OSC',
    cpp: 'C++ OSC',
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
    /**
     * Serves only the family that enters the chain at it (`dwgs`, #1666): it is
     * never a fallback for another family, and never the answer to a generic
     * `resolve()` / `generate()`. Its sound is its own waves, so landing a
     * `wav-saw` or `wgsl-saw` part on it would be a silent change of family.
     */
    entryOnly?: boolean;
    /**
     * Filter responses this backend can bake into a table from `cutoff` /
     * `resonance` / `filterType` (#1663): `wam` all three, `pyodide` lowpass
     * only. Omitted means it bakes no filter (it ignores those fields), so any
     * `filterType` is fine for it.
     */
    filterTypes?: readonly FilterType[];
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
    /** Cutoff in Hz of the filter a backend bakes into its table. Backends without a filter ignore it. */
    cutoff: number;
    /** Filter resonance / Q. Backends without a filter ignore it. */
    resonance: number;
    /**
     * Response of the baked filter (#1663). Absent means `lp`. A backend that
     * bakes a filter (`capabilities.filterTypes`) renders exactly this or is
     * skipped by the registry — it never bakes a lowpass when asked for a
     * high pass.
     */
    filterType?: FilterType;
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
 * A live, worklet-resident oscillator a `Voice` plays through instead of a
 * looped table (#1664). It behaves like the `OscillatorNode` it replaces:
 *
 *   - `output` is connected by the voice into its own filter → VCA chain;
 *   - `frequency` is an a-rate `AudioParam` in Hz, so slides and pitch
 *     automation are scheduled on it exactly as on `OscillatorNode.frequency`;
 *   - `start`/`stop` open and close the kernel's gate at an audio time (sample
 *     accurate). A closed gate costs nothing: the processor writes no samples.
 *
 * A voice keeps the same `RealtimeVoice` across notes (no node churn per note)
 * and hands it back with `release()` when it switches to another family.
 */
export interface RealtimeVoice {
    readonly backendId: OscillatorBackendId;
    readonly output: AudioNode;
    readonly frequency: AudioParam;
    /**
     * Open the gate at `when`, playing `shape`. A closed→open edge resets phase.
     * `variant` is the parsed waveform's timbre for families that have one
     * (`dwgs`: the DWGS wave); basic-wave engines ignore it.
     */
    start(when: number, shape: WaveShape, variant?: string): void;
    /** Close the gate at `when`. */
    stop(when: number): void;
    /** True while the backend can still drive this voice (not released / disposed). */
    readonly alive: boolean;
    /** Close the gate now, disconnect, and return the voice to its backend. */
    release(): void;
}

/**
 * Normalized surface shared by every oscillator backend.
 *
 * `generate` is the required offline rendering primitive. On the realtime note
 * path a backend offers exactly one of: `renderLoop` (a table producer), or
 * `acquireVoice` (a worklet-resident engine that owns a live source per voice).
 * `js` offers neither — it is the terminal `OscillatorNode` step.
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
    /**
     * Realtime path for a worklet-resident engine: a live source for one voice
     * on `ctx`, or null when it cannot provide one now (caller falls back, logged).
     *
     * `reuse` is the voice's current source; a backend returns it unchanged when
     * it is its own and still alive, so a voice does not churn nodes per note.
     */
    acquireVoice?(ctx: BaseAudioContext, reuse: RealtimeVoice | null): RealtimeVoice | null;
    dispose(): void;
}

/** Convenience guard used by selection code — keeps the checks in one place. */
export function isBackendUsable(backend: OscillatorBackend | null | undefined): backend is OscillatorBackend {
    return !!backend && backend.isSupported && backend.isReady;
}
