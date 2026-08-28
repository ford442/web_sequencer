/**
 * Regression test for the shadow-playback-stack class of bug: a previous
 * refactor (#1081) split sampler playback into this folder but left the old
 * monolithic `samplerPlayback.ts` in the tree as an unreachable duplicate,
 * and it came back once already. This guards both ends: the old file(s)
 * must not exist, and `createPlaySamplerVoice` must have exactly one
 * definition in the whole tree.
 */

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(__dirname, '../../../../..');
const SRC = join(ROOT, 'src');

const DELETED_DUPLICATES = [
    'src/hooks/audioEngine/samplerPlayback.ts',
    'src/audio/playback/synthPlayback.ts',
    'src/audio/playback/drumPlayback.ts',
    'src/audio/playback/samplerPlayback.ts',
    'src/audio/playback/index.ts',
];

function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === '__tests__' || entry.name.startsWith('.')) continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
            walk(full, out);
        } else if (/\.tsx?$/.test(entry.name)) {
            out.push(full);
        }
    }
    return out;
}

describe('sampler playback has a single entry point', () => {
    it('does not resurrect the deleted duplicate playback modules', () => {
        for (const relative of DELETED_DUPLICATES) {
            expect(existsSync(join(ROOT, relative))).toBe(false);
        }
    });

    it('defines createPlaySamplerVoice exactly once in src/', () => {
        const files = walk(SRC);
        const definitions = files.filter((file) =>
            /export function createPlaySamplerVoice\b/.test(readFileSync(file, 'utf8')),
        );
        expect(definitions).toEqual([
            join(SRC, 'hooks', 'audioEngine', 'samplerPlayback', 'playSamplerVoice.ts'),
        ]);
    });

    it('audio/playback/ only contains the live health monitor', () => {
        const entries = readdirSync(join(SRC, 'audio', 'playback'));
        expect(entries.sort()).toEqual(['PlaybackHealthMonitor.ts']);
    });
});
