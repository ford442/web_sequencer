/**
 * hyphon_native's memory is fixed (ALLOW_MEMORY_GROWTH=0,
 * docs/wasm/BUILD_NOTES.md#fixed-voice-memory), so two things must hold on the
 * BUILT modules, not just in the build script:
 *
 *   1. each profile imports one memory with initial == maximum == the budget, and
 *      the worklets' createHyphonMemory() hands it exactly that;
 *   2. that memory holds the ceiling the worklets can ask for: every voice slot of
 *      every engine created, initialised at NATIVE_VOICE_MAX_BLOCK_FRAMES and
 *      rendering (tools/render_hyphon_native_parity.mjs slots).
 *
 * A new voice, a bigger slot count or a larger per-voice buffer that no longer
 * fits fails here, with the high-water mark, instead of as a NULL malloc in a
 * user's session.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkFixedMemory, parseWasmImports } from '../../tools/check_hyphon_st_module.mjs';
import {
    HYPHON_NATIVE_ARTIFACTS,
    NATIVE_VOICE_MAX_BLOCK_FRAMES,
    createHyphonMemory,
} from '../audio-worklets/hyphonNativeImports';
import { repoRoot, requireRepoArtifacts } from '@/test/helpers/requireRepoArtifacts';

const ROOT = repoRoot();
const budget = JSON.parse(readFileSync(join(ROOT, 'emscripten/wasm_memory_budget.json'), 'utf8')) as Record<
    'hyphonNative' | 'hyphonNativeSt',
    { initialMemoryMb: number }
>;

const PROFILES = [
    { threading: 'pthread', budgetKey: 'hyphonNative' },
    { threading: 'st', budgetKey: 'hyphonNativeSt' },
] as const;

describe.each(PROFILES)('hyphon_native ($threading) fixed memory', ({ threading, budgetKey }) => {
    const artifact = HYPHON_NATIVE_ARTIFACTS[threading];
    const wasmRel = `public/${artifact.wasm}`;
    const mapRel = `public/${artifact.exportMap}`;

    it('imports one memory fixed at the budget', () => {
        requireRepoArtifacts([wasmRel]);
        const wasm = readFileSync(join(ROOT, wasmRel));
        expect(checkFixedMemory(wasm, budget[budgetKey].initialMemoryMb)).toEqual([]);
        const [memory] = parseWasmImports(wasm).filter((i) => i.kind === 'memory');
        expect(memory.shared).toBe(artifact.sharedMemory);
        expect(memory.initial).toBe(artifact.minMemoryPages);
        expect(memory.maximum).toBe(artifact.maxMemoryPages);
    });

    it('is instantiated with exactly that memory by the worklet path', () => {
        requireRepoArtifacts([wasmRel]);
        const memory = createHyphonMemory(artifact.minMemoryPages, artifact.sharedMemory);
        expect(memory.buffer.byteLength).toBe(artifact.minMemoryPages * 65536);
        // A grow past the fixed size is refused by the memory itself.
        expect(() => memory.grow(1)).toThrow();
    });

    it('holds every voice slot at the largest block the worklets allow', () => {
        requireRepoArtifacts([wasmRel, mapRel]);
        const out = execFileSync(
            'node',
            [
                join(ROOT, 'tools/render_hyphon_native_parity.mjs'),
                'slots',
                '--wasm', join(ROOT, wasmRel),
                '--map', join(ROOT, mapRel),
                '--sr', '192000',
                '--block', String(NATIVE_VOICE_MAX_BLOCK_FRAMES),
            ],
            { encoding: 'utf8' },
        );
        const result = JSON.parse(out) as {
            slots: Record<string, number>;
            highWaterMb: number;
            memoryMb: number;
            failures: string[];
        };
        expect(result.failures).toEqual([]);
        expect(result.memoryMb).toBe(budget[budgetKey].initialMemoryMb);
        // Every HYPHON_EXPORT_VOICE engine took part.
        expect(Object.keys(result.slots).sort()).toEqual(
            ['drumkit', 'highfid303', 'jc303', 'macro', 'open303', 'prophecy'],
        );
        expect(result.highWaterMb).toBeLessThan(result.memoryMb);
    });
});
