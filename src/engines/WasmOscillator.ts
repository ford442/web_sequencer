// @mode: bridge
// @note-for-ai: This is the TypeScript bridge to the AssemblyScript WASM module.
// The heavy DSP logic is in assembly/oscillators.ts. This file handles:
// - WASM loading and initialization (variant selection + capability probe)
// - Memory management (copying data out of WASM memory)
// - Error handling and fallback paths

import initOscillatorsBaseline from '../wasm/oscillators.wasm?init';
import { engineTelemetry, logEngineFallback } from '@/utils/engineTelemetry';

interface OscillatorWasmExports {
    memory: WebAssembly.Memory;
    generate: (
        offset: number,
        rate: number,
        freq: number,
        dur: number,
        type: number,
        cutoff: number,
        resonance: number,
    ) => number;
    /**
     * Same arguments as `generate`; renders a table with a whole number of
     * cycles and a settled filter so a looped `AudioBufferSourceNode` does not
     * click on every wrap. Absent on a build that predates it.
     */
    generateLoop?: OscillatorWasmExports['generate'];
}

/** Which of the two shipped builds an instance ended up running. */
export type OscillatorVariant = 'relaxed' | 'baseline';

/**
 * Minimal module that only validates on an engine with relaxed SIMD:
 *
 *   (module (func (result v128)
 *     i32.const 0  i8x16.splat
 *     i32.const 0  i8x16.splat
 *     i8x16.relaxed_swizzle))
 *
 * `i8x16.relaxed_swizzle` is 0xFD 0x80 0x02 (prefixed opcode 256).
 *
 * Feature detection has to happen here, in the engine wrapper, and not in a
 * worklet: an unsupported instruction is a `CompileError` raised by
 * `WebAssembly.compile`/`validate`, i.e. before any worklet exists to fall back.
 */
const RELAXED_SIMD_PROBE = new Uint8Array([
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, // magic + version
    0x01, 0x05, 0x01, 0x60, 0x00, 0x01, 0x7b,       // type: () -> v128
    0x03, 0x02, 0x01, 0x00,                         // func 0 : type 0
    0x0a, 0x0f, 0x01, 0x0d, 0x00,                   // code section, 1 body, 0 locals
    0x41, 0x00, 0xfd, 0x0f,                         // i32.const 0; i8x16.splat
    0x41, 0x00, 0xfd, 0x0f,                         // i32.const 0; i8x16.splat
    0xfd, 0x80, 0x02,                               // i8x16.relaxed_swizzle
    0x0b,                                           // end
]);

let relaxedSimdSupport: boolean | null = null;

/**
 * Cached capability probe for relaxed SIMD. Safe to call before any AudioContext.
 *
 * Nothing selects on this today — see `loadOrder()`. It is reported to telemetry
 * so the question "is a relaxed-SIMD kernel worth building?" can be answered from
 * field data rather than guessed.
 */
export function supportsRelaxedSimd(): boolean {
    if (relaxedSimdSupport !== null) return relaxedSimdSupport;
    try {
        relaxedSimdSupport =
            typeof WebAssembly !== 'undefined' &&
            typeof WebAssembly.validate === 'function' &&
            WebAssembly.validate(RELAXED_SIMD_PROBE);
    } catch {
        relaxedSimdSupport = false;
    }
    return relaxedSimdSupport;
}

/** Test seam: forget the cached probe result. */
export function resetRelaxedSimdProbe(): void {
    relaxedSimdSupport = null;
}

type WasmInit = typeof initOscillatorsBaseline;

/**
 * Candidate builds, most-preferred first.
 *
 * There is exactly one today, and that is a measured decision, not an oversight.
 * `assembly/oscillators.ts` is scalar — it contains no SIMD intrinsics — so
 * building it a second time with `--enable relaxed-simd` produced a byte-identical
 * module (same SHA-256); asc never emits a relaxed instruction that is not written.
 * A relaxed sibling would have been a duplicate artifact and a second download for
 * no measurable win. See docs/wasm/BUILD_NOTES.md#assemblyscript-browser-matrix.
 *
 * To add one when a relaxed kernel actually exists: add a `build:wasm:*` script
 * emitting `src/wasm/oscillators.relaxed.wasm`, register it in
 * `scripts/native-worlds.mjs` (so the artifact is always built and the static
 * import below can never be a missing asset), import it, and prepend it here
 * guarded by `supportsRelaxedSimd()`. The retry loop in `init()` already handles
 * the fallback.
 */
function loadOrder(): Array<{ variant: OscillatorVariant; init: WasmInit }> {
    return [{ variant: 'baseline', init: initOscillatorsBaseline }];
}

const typeMap = { saw: 0, sqr: 1, tri: 2, sin: 3 };

const WASM_PAGE_BYTES = 65536;
/** Ceiling for one render, in frames (16 Mi f32 = 64 MB): a runaway duration must not eat the heap. */
const MAX_RENDER_FRAMES = 1 << 24;

export class WasmOscillator {
    private instance: WebAssembly.Instance | null = null;
    private memory: WebAssembly.Memory | null = null;
    isReady: boolean = false;
    /** Which build is live, or null until a successful init(). */
    variant: OscillatorVariant | null = null;

    async init() {
        const attempts = loadOrder();
        const failures: string[] = [];

        for (const { variant, init } of attempts) {
            try {
                this.instance = await init({ env: { abort: () => {} } });
                this.memory = this.instance.exports.memory as WebAssembly.Memory;
                this.variant = variant;
                this.isReady = true;
                try {
                    engineTelemetry.registerResolution(
                        'wam',
                        'wasm',
                        `loaded:${variant} relaxed-simd=${supportsRelaxedSimd()}`,
                    );
                } catch (_) { /* telemetry is best-effort */ }
                return;
            } catch (e) {
                // Try the next candidate rather than going silent — silence is the
                // failure mode a hard-failing feature module produces on old Safari,
                // and it is the one thing this loader exists to prevent.
                this.instance = null;
                this.memory = null;
                failures.push(`${variant}: ${e instanceof Error ? e.message : String(e)}`);
            }
        }

        logEngineFallback(
            'wam',
            'wasm',
            `AssemblyScript oscillators.wasm instantiation failed (${failures.join('; ')})`,
            failures[failures.length - 1],
        );
    }

    /**
     * Render a table of f32 mono samples, or null when the engine is not ready.
     *
     * `loop` asks for a seamlessly loopable table: the length is rounded to a whole
     * number of cycles (so it can differ from `dur * rate` by up to one cycle) and
     * the pitch moves by less than half a frame per table. Leave it off for a
     * one-shot note, which is exactly `floor(dur * rate)` frames from a filter at rest.
     *
     * A bad argument (non-finite or non-positive pitch/duration) comes back as an
     * empty array rather than a trap; the kernel never writes past linear memory.
     */
    generate(
        freq: number,
        dur: number,
        rate: number,
        type: 'saw' | 'sqr' | 'tri' | 'sin',
        cutoff: number,
        resonance: number,
        loop: boolean = false,
    ): Float32Array | null {
        if (!this.isReady || !this.instance || !this.memory) return null;

        const exports = this.instance.exports as unknown as OscillatorWasmExports;

        // Constraints
        const safeCutoff = Math.max(20, Math.min(rate / 2.1, cutoff));
        const safeRes = Math.max(0.1, resonance);

        this.reserve(Math.ceil(rate * dur) + (loop ? Math.ceil(rate / Math.max(freq, 1)) : 0));

        // Generate
        // We use offset 0 in the shared memory
        const kernel = loop && exports.generateLoop ? exports.generateLoop : exports.generate;
        const numSamples = kernel(0, rate, freq, dur, typeMap[type], safeCutoff, safeRes);

        // Copy the data out safely by explicitly allocating the returned array size
        // If we don't copy, the view changes when the next note is generated!
        // Bolt Optimization: Avoiding .slice() which creates an intermediate view
        const out = new Float32Array(numSamples);
        out.set(new Float32Array(this.memory.buffer, 0, numSamples));
        return out;
    }

    /**
     * Make room for `frames` f32 samples at offset 0. The module's fixed 24 MB
     * covers every table and any note up to ~60 s at 48 kHz; a longer render used
     * to be cut off at the end of memory. This module runs on the main thread, not
     * in a worklet, so it may grow (the "no growth" rule is for worklet-loaded
     * wasm). Growth detaches `memory.buffer`, which is why `generate` reads it
     * only after this returns.
     */
    private reserve(frames: number): void {
        if (!this.memory || !Number.isFinite(frames) || frames <= 0) return;
        const needed = Math.min(frames, MAX_RENDER_FRAMES) * 4;
        const have = this.memory.buffer.byteLength;
        if (needed <= have) return;
        try {
            this.memory.grow(Math.ceil((needed - have) / WASM_PAGE_BYTES));
        } catch (_) {
            // Out of memory: the kernel truncates to what fits instead of trapping.
        }
    }
}
