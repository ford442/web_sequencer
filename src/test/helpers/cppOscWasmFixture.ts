/**
 * Hand-encoded stand-ins for public/cpp_osc.wasm (#1665), so the release gate
 * and tools/check_cpp_osc_module.mjs can be tested hermetically (no emsdk, no
 * build artifact).
 *
 * The `valid` module has the real export surface with trivial bodies: ABI 1,
 * latency 16, 8-frame buffers at offsets 0 and 32, an init that accepts the
 * rate and a render that renders nothing. It is valid *to the checker*; it is
 * not an oscillator. Each other variant breaks exactly one property.
 */

import { CPP_OSC_BUDGET } from '../../../tools/check_cpp_osc_module.mjs';

export type CppOscFixtureVariant = 'valid' | 'growable-memory' | 'simd' | 'wrong-abi' | 'missing-render';

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
const V128 = 0x7b;

/** Small non-negative i32 constant (< 64, so one SLEB byte). */
function i32Body(value: number): number[] {
    return [0x00, 0x41, value, 0x0b];
}

export function cppOscWasmFixture(variant: CppOscFixtureVariant = 'valid'): Uint8Array<ArrayBuffer> {
    const types = section(1, [
        ...uleb(variant === 'simd' ? 5 : 4),
        0x60, 0, 1, I32, //                 t0: () -> i32
        0x60, 1, F32, 1, I32, //            t1: (f32) -> i32
        0x60, 1, F32, 0, //                 t2: (f32) -> ()
        0x60, 3, I32, I32, I32, 1, I32, //  t3: (i32, i32, i32) -> i32
        // What a -msimd128 build leaves behind: a v128 in a signature.
        ...(variant === 'simd' ? [0x60, 1, V128, 0] : []), // t4: (v128) -> ()
    ]);

    const funcs: Array<{ name: string; type: number; body: number[] }> = [
        { name: 'cosc_abi_version', type: 0, body: i32Body(variant === 'wrong-abi' ? 2 : 1) },
        { name: 'cosc_max_frames', type: 0, body: i32Body(8) },
        { name: 'cosc_latency', type: 0, body: i32Body(16) },
        { name: 'cosc_freq_ptr', type: 0, body: i32Body(0) },
        { name: 'cosc_out_ptr', type: 0, body: i32Body(32) },
        { name: 'cosc_init', type: 1, body: i32Body(1) },
        { name: 'cosc_reset', type: 2, body: [0x00, 0x0b] },
        { name: 'cosc_render', type: 3, body: i32Body(0) },
    ];
    const exported = variant === 'missing-render' ? funcs.filter((f) => f.name !== 'cosc_render') : funcs;

    const pages = CPP_OSC_BUDGET.initialMemoryPages;
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
