/**
 * Hand-encoded stand-ins for public/mix_bus.wasm, so the release gate and the
 * module checker can be tested hermetically (no emcc, no build artifact).
 *
 * The `valid` module has the real export surface with trivial bodies:
 * ABI 1, 8-frame blocks at offsets 0 and 32, a no-op accumulate and a zero
 * peak. Each other variant breaks exactly one property the checker enforces.
 */

export type MixBusFixtureVariant =
    | 'valid'
    | 'growable-memory'
    | 'shared-memory'
    | 'with-import'
    | 'missing-peak'
    | 'wrong-abi';

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

export function mixBusWasmFixture(variant: MixBusFixtureVariant = 'valid'): Uint8Array<ArrayBuffer> {
    const types = section(1, [
        ...uleb(3),
        0x60, 0, 1, I32, //          t0: () -> i32
        0x60, 2, I32, F32, 0, //     t1: (i32, f32) -> ()
        0x60, 1, I32, 1, F32, //     t2: (i32) -> f32
    ]);

    const withImport = variant === 'with-import';
    const imports = withImport
        ? section(2, [...uleb(1), ...name('env'), ...name('now'), 0x00, ...uleb(0)])
        : [];
    const importedFuncs = withImport ? 1 : 0;

    const funcs: Array<{ name: string; type: number; body: number[] }> = [
        { name: 'mix_bus_abi_version', type: 0, body: i32Body(variant === 'wrong-abi' ? 2 : 1) },
        { name: 'mix_bus_block_frames', type: 0, body: i32Body(8) },
        { name: 'mix_bus_in_ptr', type: 0, body: i32Body(0) },
        { name: 'mix_bus_acc_ptr', type: 0, body: i32Body(32) },
        { name: 'mix_bus_accumulate', type: 1, body: [0x00, 0x0b] },
        { name: 'mix_bus_peak', type: 2, body: [0x00, 0x43, 0, 0, 0, 0, 0x0b] },
    ];
    const exported = variant === 'missing-peak' ? funcs.filter((f) => f.name !== 'mix_bus_peak') : funcs;

    const functionSection = section(3, [...uleb(funcs.length), ...funcs.map((f) => f.type)]);

    const limits =
        variant === 'growable-memory' ? [0x01, ...uleb(1), ...uleb(4)]
            : variant === 'shared-memory' ? [0x03, ...uleb(1), ...uleb(1)]
                : [0x01, ...uleb(1), ...uleb(1)];
    const memory = section(5, [...uleb(1), ...limits]);

    const exports = section(7, [
        ...uleb(exported.length + 1),
        ...name('memory'), 0x02, ...uleb(0),
        ...exported.flatMap((f) => [...name(f.name), 0x00, ...uleb(funcs.indexOf(f) + importedFuncs)]),
    ]);

    const code = section(10, [
        ...uleb(funcs.length),
        ...funcs.flatMap((f) => [...uleb(f.body.length), ...f.body]),
    ]);

    return new Uint8Array([
        0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
        ...types, ...imports, ...functionSection, ...memory, ...exports, ...code,
    ]);
}
