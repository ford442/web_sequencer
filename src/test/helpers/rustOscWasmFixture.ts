/**
 * Hand-encoded stand-ins for public/rust_osc.wasm (#1664), so the release gate
 * and tools/check_rust_osc_module.mjs can be tested hermetically (no cargo, no
 * build artifact).
 *
 * The `valid` module has the real export surface with trivial bodies: ABI 1,
 * SIMD reported, 8-frame buffers at offsets 0, 32 and 64, an init that accepts the
 * rate, renders that render nothing and a filter (#1672) that accepts lowpass. It is valid *to the checker*; it is not
 * an oscillator. Each other variant breaks exactly one property.
 */

import { RUST_OSC_BUDGET } from '../../../tools/check_rust_osc_module.mjs';

export type RustOscFixtureVariant =
    | 'valid'
    | 'growable-memory'
    | 'scalar-only'
    | 'wrong-abi'
    | 'missing-render'
    | 'missing-filter'
    | 'accepts-any-filter-type';

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

function section(id: number, payload: number[]): number[] {
    return [id, ...uleb(payload.length), ...payload];
}

function name(text: string): number[] {
    const bytes = [...Buffer.from(text, 'utf8')];
    return [...uleb(bytes.length), ...bytes];
}

const I32 = 0x7f;
const F32 = 0x7d;

/** Small non-negative i32 constant (< 64, so one SLEB byte). */
function i32Body(value: number): number[] {
    return [0x00, 0x41, value, 0x0b];
}

export function rustOscWasmFixture(variant: RustOscFixtureVariant = 'valid'): Uint8Array<ArrayBuffer> {
    const types = section(1, [
        ...uleb(7),
        0x60, 0, 1, I32, //                 t0: () -> i32
        0x60, 1, F32, 1, I32, //            t1: (f32) -> i32
        0x60, 1, F32, 0, //                 t2: (f32) -> ()
        0x60, 3, I32, I32, I32, 1, I32, //  t3: (i32, i32, i32) -> i32
        0x60, 4, F32, F32, F32, I32, 1, I32, // t4: (f32, f32, f32, i32) -> i32
        0x60, 0, 0, //                      t5: () -> ()
        0x60, 1, I32, 1, I32, //            t6: (i32) -> i32
    ]);

    const funcs: Array<{ name: string; type: number; body: number[] }> = [
        { name: 'rosc_abi_version', type: 0, body: i32Body(variant === 'wrong-abi' ? 3 : 2) },
        { name: 'rosc_max_frames', type: 0, body: i32Body(8) },
        { name: 'rosc_simd', type: 0, body: i32Body(variant === 'scalar-only' ? 0 : 1) },
        { name: 'rosc_freq_ptr', type: 0, body: i32Body(0) },
        { name: 'rosc_out_ptr', type: 0, body: i32Body(32) },
        { name: 'rosc_init', type: 1, body: i32Body(1) },
        { name: 'rosc_reset', type: 2, body: [0x00, 0x0b] },
        { name: 'rosc_render', type: 3, body: i32Body(0) },
        { name: 'rosc_render_scalar', type: 3, body: i32Body(0) },
        { name: 'rflt_buf_ptr', type: 0, body: i32Body(64) },
        // Accepts only the lowpass (kind 0), like the kernel refuses an unknown type:
        // (local.get 3) == 0, unless the 'accepts-any-filter-type' variant always says 1.
        {
            name: 'rflt_configure',
            type: 4,
            body: variant === 'accepts-any-filter-type'
                ? i32Body(1)
                : [0x00, 0x20, 3, 0x45, 0x0b],
        },
        { name: 'rflt_reset', type: 5, body: [0x00, 0x0b] },
        { name: 'rflt_process', type: 6, body: [0x00, 0x20, 0, 0x0b] },
    ];
    const exported = variant === 'missing-render'
        ? funcs.filter((f) => f.name !== 'rosc_render')
        : variant === 'missing-filter'
            ? funcs.filter((f) => !f.name.startsWith('rflt_'))
            : funcs;

    const pages = RUST_OSC_BUDGET.initialMemoryPages;
    const limits = variant === 'growable-memory'
        ? [0x01, ...uleb(pages), ...uleb(pages + 1)]
        : [0x01, ...uleb(pages), ...uleb(pages)];

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
    ]);
}
