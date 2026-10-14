/**
 * Contract for public/mix_bus.wasm (#1341), hermetic: the release gate's
 * checker and the worker's loader are run against hand-encoded modules, and
 * the three places that list the export surface are held in step.
 *
 * The real binary is exercised by mixBus.integration.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    MIX_BUS_ABI_VERSION as CHECKER_ABI,
    MIX_BUS_REQUIRED_EXPORTS as CHECKER_EXPORTS,
    checkMixBusModule,
} from '../../tools/check_mix_bus_module.mjs';
import {
    MIX_BUS_ABI_VERSION,
    MIX_BUS_REQUIRED_EXPORTS,
    createNativeMixKernel,
} from '../audio/offline/mixBus/mixBusKernel';
import { mixBusWasmFixture } from '../test/helpers/mixBusWasmFixture';

const REPO_ROOT = join(__dirname, '../..');
const buildMixBusSh = readFileSync(join(REPO_ROOT, 'emscripten/build_mix_bus.sh'), 'utf8');
const mixBusCpp = readFileSync(join(REPO_ROOT, 'emscripten/mix_bus.cpp'), 'utf8');

describe('mix bus export surface', () => {
    it('build script, release checker and worker loader name the same exports', () => {
        const block = /MIX_BUS_EXPORTS=\(([\s\S]*?)\)/.exec(buildMixBusSh)?.[1] ?? '';
        const fromScript = block.split(/\s+/).filter(Boolean);
        expect(fromScript).toEqual([...MIX_BUS_REQUIRED_EXPORTS]);
        expect(CHECKER_EXPORTS).toEqual([...MIX_BUS_REQUIRED_EXPORTS]);
    });

    it('every export is defined in mix_bus.cpp, and the ABI versions agree', () => {
        for (const name of MIX_BUS_REQUIRED_EXPORTS) {
            expect(mixBusCpp, name).toMatch(new RegExp(`EMSCRIPTEN_KEEPALIVE [\\w*]+ ${name}\\(`));
        }
        expect(mixBusCpp).toContain(`kAbiVersion = ${MIX_BUS_ABI_VERSION};`);
        expect(CHECKER_ABI).toBe(MIX_BUS_ABI_VERSION);
    });
});

describe('tools/check_mix_bus_module.mjs', () => {
    it('accepts a fixed, unshared, import-free module with the full surface', () => {
        expect(checkMixBusModule(mixBusWasmFixture('valid'))).toEqual([]);
    });

    it.each([
        ['growable-memory', 'memory can grow'],
        ['shared-memory', 'memory is shared'],
        ['with-import', 'expected zero imports'],
        ['missing-peak', 'missing exports: mix_bus_peak'],
        ['wrong-abi', 'ABI version 2'],
    ] as const)('rejects %s', (variant, message) => {
        const problems = checkMixBusModule(mixBusWasmFixture(variant));
        expect(problems.join('\n')).toContain(message);
    });
});

describe('createNativeMixKernel', () => {
    it('binds a valid module', async () => {
        const kernel = await createNativeMixKernel(mixBusWasmFixture('valid'));
        expect(kernel.kind).toBe('native');
    });

    it('refuses a module with imports, naming the cause', async () => {
        await expect(createNativeMixKernel(mixBusWasmFixture('with-import'))).rejects.toThrow(/import/);
    });

    it('refuses a stale build missing an export', async () => {
        await expect(createNativeMixKernel(mixBusWasmFixture('missing-peak'))).rejects.toThrow(
            /missing exports: mix_bus_peak.*build:wasm:mixbus/,
        );
    });

    it('refuses an ABI mismatch', async () => {
        await expect(createNativeMixKernel(mixBusWasmFixture('wrong-abi'))).rejects.toThrow(/ABI 2/);
    });
});
