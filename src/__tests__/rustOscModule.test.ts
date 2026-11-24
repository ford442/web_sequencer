/**
 * Contract for public/rust_osc.wasm (#1664), hermetic: the places that name the
 * export surface, the ABI version and the fixed memory size are held in step,
 * and the release checker rejects the modules it exists to reject.
 *
 * The real binary is exercised by
 * src/audio-worklets/__tests__/rustOscVoice.realWasm.test.ts (integration tier).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    RUST_OSC_ABI_VERSION as CHECKER_ABI,
    RUST_OSC_BUDGET,
    RUST_OSC_REQUIRED_EXPORTS as CHECKER_EXPORTS,
    checkRustOscModule,
} from '../../tools/check_rust_osc_module.mjs';
import { rustOscRustflags } from '../../scripts/build-rust-osc.mjs';
import { RUST_OSC_ABI_VERSION, RUST_OSC_REQUIRED_EXPORTS, RUST_OSC_SHAPE_ID } from '../audio-worklets/rustOsc';
import { RUST_FILTER_ABI_VERSION, RUST_FILTER_REQUIRED_EXPORTS, RUST_FILTER_TYPE_ID } from '../audio-worklets/rustFilter';
import { rustOscWasmFixture } from '../test/helpers/rustOscWasmFixture';

const REPO_ROOT = join(__dirname, '../..');
const libRs = readFileSync(join(REPO_ROOT, 'rust-audio/src/lib.rs'), 'utf8');

describe('rust_osc export surface', () => {
    it('manifest, release checker and worklet name the same exports', () => {
        const manifest = JSON.parse(readFileSync(join(REPO_ROOT, 'emscripten/wasm_export_manifest.json'), 'utf8')) as {
            rustOsc: { required: string[]; requiredFilter: string[] };
        };
        expect([...RUST_OSC_REQUIRED_EXPORTS]).toEqual(manifest.rustOsc.required);
        expect([...RUST_FILTER_REQUIRED_EXPORTS]).toEqual(manifest.rustOsc.requiredFilter);
        expect(CHECKER_EXPORTS).toEqual([...manifest.rustOsc.required, ...manifest.rustOsc.requiredFilter]);
    });

    it('every export is a #[no_mangle] extern "C" fn in lib.rs, and nothing else is', () => {
        const defined = [...libRs.matchAll(/#\[no_mangle\]\s*pub extern "C" fn (\w+)\(/g)].map((m) => m[1]);
        expect(defined.sort()).toEqual([...RUST_OSC_REQUIRED_EXPORTS, ...RUST_FILTER_REQUIRED_EXPORTS].sort());
    });

    it('the ABI version agrees in lib.rs, the checker and the worklet', () => {
        expect(libRs).toContain(`pub const ABI_VERSION: u32 = ${RUST_OSC_ABI_VERSION};`);
        expect(CHECKER_ABI).toBe(RUST_OSC_ABI_VERSION);
    });

    it('the filter worklet binds to the same ABI, and its response ids agree with the kernel', () => {
        expect(RUST_FILTER_ABI_VERSION).toBe(RUST_OSC_ABI_VERSION);
        const consts = { lp: 'FILTER_LP', bp: 'FILTER_BP', hp: 'FILTER_HP' } as const;
        for (const [type, id] of Object.entries(RUST_FILTER_TYPE_ID)) {
            expect(libRs, type).toContain(`pub const ${consts[type as keyof typeof consts]}: u32 = ${id};`);
        }
    });

    it('shape ids agree with the kernel', () => {
        for (const [shape, id] of Object.entries(RUST_OSC_SHAPE_ID)) {
            expect(libRs, shape).toContain(`pub const SHAPE_${shape.toUpperCase()}: u32 = ${id};`);
        }
    });
});

describe('rust_osc fixed memory (BUILD_NOTES#fixed-voice-memory)', () => {
    it('the build passes the budget to wasm-ld: initial == maximum, with SIMD', () => {
        const flags = rustOscRustflags();
        const bytes = RUST_OSC_BUDGET.initialMemoryPages * 65536;
        expect(flags).toContain('target-feature=+simd128');
        expect(flags).toContain(`link-arg=--initial-memory=${bytes}`);
        expect(flags).toContain(`link-arg=--max-memory=${bytes}`);
        expect(flags).toContain(`link-arg=-zstack-size=${RUST_OSC_BUDGET.stackSizeBytes}`);
    });

    it('the kernel has no allocator and no std', () => {
        expect(libRs).toMatch(/#!\[cfg_attr\(not\(test\), no_std\)\]/);
        expect(libRs).not.toMatch(/extern crate alloc|#\[global_allocator\]/);
    });
});

// ── Hand-encoded modules the checker must reject ─────────────────────────────

const leb = (n: number) => {
    const out: number[] = [];
    do {
        let b = n & 0x7f;
        n >>>= 7;
        if (n) b |= 0x80;
        out.push(b);
    } while (n);
    return out;
};
const section = (id: number, body: number[]) => [id, ...leb(body.length), ...body];
const name = (s: string) => [...leb(s.length), ...[...s].map((c) => c.charCodeAt(0))];
const header = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];

/** A module whose only content is a memory (limits as given), exported as `memory`. */
function memoryOnly(initial: number, maximum: number | null): Uint8Array {
    const limits = maximum === null ? [0x00, ...leb(initial)] : [0x01, ...leb(initial), ...leb(maximum)];
    return new Uint8Array([
        ...header,
        ...section(5, [0x01, ...limits]),
        ...section(7, [0x01, ...name('memory'), 0x02, 0x00]),
    ]);
}

/** Same, plus one imported function `env.f`. */
function withImport(): Uint8Array {
    return new Uint8Array([
        ...header,
        ...section(1, [0x01, 0x60, 0x00, 0x00]),
        ...section(2, [0x01, ...name('env'), ...name('f'), 0x00, 0x00]),
        ...section(5, [0x01, 0x01, 0x02, 0x02]),
        ...section(7, [0x01, ...name('memory'), 0x02, 0x00]),
    ]);
}

describe('tools/check_rust_osc_module.mjs', () => {
    const pages = RUST_OSC_BUDGET.initialMemoryPages;

    it('accepts a fixed, import-free module with the full surface (oscillator + filter), ABI 2 and SIMD', () => {
        expect(checkRustOscModule(rustOscWasmFixture('valid'))).toEqual([]);
    });

    it.each([
        ['growable-memory', 'memory can grow'],
        ['scalar-only', 'v128 render path was not compiled in'],
        ['wrong-abi', 'ABI version 3'],
        ['missing-render', 'missing exports: rosc_render'],
        ['missing-filter', 'missing exports: rflt_buf_ptr, rflt_configure, rflt_reset, rflt_process'],
        ['accepts-any-filter-type', 'rflt_configure accepted an unknown filter type'],
    ] as const)('rejects the %s fixture', (variant, message) => {
        expect(checkRustOscModule(rustOscWasmFixture(variant)).join('\n')).toContain(message);
    });

    it.each([
        ['growable memory', memoryOnly(pages, pages + 1), 'memory can grow'],
        ['unbounded memory', memoryOnly(pages, null), 'memory has no maximum'],
        ['wrong size', memoryOnly(pages + 1, pages + 1), `wasm_memory_budget.json rustOsc says ${pages}`],
        ['an import', withImport(), 'expected zero imports'],
        ['no kernel', memoryOnly(pages, pages), 'missing exports: rosc_abi_version'],
    ] as const)('rejects a module with %s', (_label, wasm, message) => {
        expect(checkRustOscModule(wasm).join('\n')).toContain(message);
    });

    it('rejects bytes that do not compile', () => {
        expect(checkRustOscModule(new Uint8Array([1, 2, 3]))[0]).toMatch(/does not compile/);
    });
});
