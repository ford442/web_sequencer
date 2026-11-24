/**
 * Hand-encoded stand-ins for public/dwgs_osc.wasm (#1666), so the release gate
 * and tools/check_dwgs_osc_module.mjs can be tested hermetically (no cargo, no
 * build artifact).
 *
 * The `valid` module has the real export surface with trivial bodies: ABI 2,
 * 17 waves, 64-frame buffers at offsets 0, 256 and 512 (freq, out — prefilled
 * with 0.5 by a data segment — and the DWGS filter's, #1674), an init that
 * accepts the rate, a render that reports the frames it was asked for, and a
 * `dflt_configure` that accepts only filter type 0. It is valid *to the
 * checker*; it is neither an oscillator nor a filter. Each other variant breaks
 * exactly one property.
 */

import { DWGS_OSC_BUDGET, DWGS_OSC_WAVE_COUNT } from '../../../tools/check_dwgs_osc_module.mjs';

export type DwgsOscFixtureVariant =
    | 'valid'
    | 'growable-memory'
    | 'simd'
    | 'wrong-abi'
    | 'wrong-wave-count'
    | 'missing-render'
    | 'missing-filter'
    | 'accepts-any-filter-type'
    | 'silent';

function uleb(value: number): number[] {
    const out: number[] = [];
    let n = value;
    do {
        let byte = n & 0x7f;
        n >>>= 7;
        if (n !== 0) byte |= 0x80;
        out.push(byte);
    } while (n !== 0);
    return out;
}

/** Signed LEB128 for i32.const. */
function sleb(value: number): number[] {
    const out: number[] = [];
    let n = value;
    for (;;) {
        const byte = n & 0x7f;
        n >>= 7;
        if ((n === 0 && (byte & 0x40) === 0) || (n === -1 && (byte & 0x40) !== 0)) {
            out.push(byte);
            return out;
        }
        out.push(byte | 0x80);
    }
}

function section(id: number, payload: number[]): number[] {
    return [id, ...uleb(payload.length), ...payload];
}

function name(text: string): number[] {
    const bytes = [...Buffer.from(text, 'utf8')];
    return [...uleb(bytes.length), ...bytes];
}

const I32 = 0x7f;
const F32 = 0x7d;
const V128 = 0x7b;

const FRAMES = 64;
const OUT_PTR = 256;
const FILTER_PTR = 512;

function i32Body(value: number): number[] {
    return [0x00, 0x41, ...sleb(value), 0x0b];
}

export function dwgsOscWasmFixture(variant: DwgsOscFixtureVariant = 'valid'): Uint8Array<ArrayBuffer> {
    const types = section(1, [
        ...uleb(variant === 'simd' ? 8 : 7),
        0x60, 0, 1, I32, //                 t0: () -> i32
        0x60, 1, F32, 1, I32, //            t1: (f32) -> i32
        0x60, 1, F32, 0, //                 t2: (f32) -> ()
        0x60, 3, I32, I32, I32, 1, I32, //  t3: (i32, i32, i32) -> i32
        0x60, 4, F32, F32, F32, I32, 1, I32, // t4: (f32, f32, f32, i32) -> i32
        0x60, 0, 0, //                      t5: () -> ()
        0x60, 1, I32, 1, I32, //            t6: (i32) -> i32
        // What a +simd128 build leaves behind: a v128 in a signature.
        ...(variant === 'simd' ? [0x60, 1, V128, 0] : []), // t7: (v128) -> ()
    ]);

    const funcs: Array<{ name: string; type: number; body: number[] }> = [
        { name: 'dwgs_abi_version', type: 0, body: i32Body(variant === 'wrong-abi' ? 1 : 2) },
        { name: 'dwgs_max_frames', type: 0, body: i32Body(FRAMES) },
        { name: 'dwgs_wave_count', type: 0, body: i32Body(variant === 'wrong-wave-count' ? DWGS_OSC_WAVE_COUNT - 1 : DWGS_OSC_WAVE_COUNT) },
        { name: 'dwgs_freq_ptr', type: 0, body: i32Body(0) },
        { name: 'dwgs_out_ptr', type: 0, body: i32Body(OUT_PTR) },
        { name: 'dwgs_init', type: 1, body: i32Body(1) },
        { name: 'dwgs_reset', type: 2, body: [0x00, 0x0b] },
        // local.get 1: "rendered" every frame asked for.
        { name: 'dwgs_render', type: 3, body: [0x00, 0x20, 0x01, 0x0b] },
        { name: 'dflt_buf_ptr', type: 0, body: i32Body(FILTER_PTR) },
        // local.get 3 (the type); i32.eqz — 1 for lowpass, 0 for anything else.
        // The broken variant answers 1 (i32.const 1) whatever it is given.
        {
            name: 'dflt_configure',
            type: 4,
            body: variant === 'accepts-any-filter-type' ? i32Body(1) : [0x00, 0x20, 3, 0x45, 0x0b],
        },
        { name: 'dflt_reset', type: 5, body: [0x00, 0x0b] },
        // Filters nothing, reports what it was given.
        { name: 'dflt_process', type: 6, body: [0x00, 0x20, 0, 0x0b] },
    ];
    const dropped = variant === 'missing-render' ? 'dwgs_render' : variant === 'missing-filter' ? 'dflt_process' : null;
    const exported = funcs.filter((f) => f.name !== dropped);

    const pages = DWGS_OSC_BUDGET.initialMemoryPages;
    const limits = variant === 'growable-memory'
        ? [0x01, ...uleb(pages), ...uleb(pages + 1)]
        : [0x01, ...uleb(pages), ...uleb(pages)];

    // 0.5f = 0x3f000000, little-endian.
    const half = Array.from({ length: FRAMES }, () => [0x00, 0x00, 0x00, 0x3f]).flat();
    const data = variant === 'silent' ? [] : section(11, [
        ...uleb(1),
        0x00, 0x41, ...sleb(OUT_PTR), 0x0b, // active segment, memory 0, offset OUT_PTR
        ...uleb(half.length), ...half,
    ]);

    return new Uint8Array([
        0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
        ...types,
        ...section(3, [...uleb(funcs.length), ...funcs.map((f) => f.type)]),
        ...section(5, [...uleb(1), ...limits]),
        ...section(7, [
            ...uleb(exported.length + 1),
            ...name('memory'), 0x02, ...uleb(0),
            ...exported.flatMap((f) => [...name(f.name), 0x00, ...uleb(funcs.indexOf(f))]),
        ]),
        ...section(10, [...uleb(funcs.length), ...funcs.flatMap((f) => [...uleb(f.body.length), ...f.body])]),
        ...data,
    ]);
}
