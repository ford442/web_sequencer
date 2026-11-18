/**
 * Static guard for the native voices' denormal flushes (#1596 follow-up P4,
 * docs/wasm/BUILD_NOTES.md#denormal-guards). The behaviour is proved by
 * emscripten/tests/denormal_tail_test.cpp under `pnpm test:native` (host g++);
 * this keeps the wiring from being deleted as dead code when that job is not run.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = join(__dirname, '../..');
const read = (rel: string) => readFileSync(join(REPO_ROOT, rel), 'utf8');

describe('native voice denormal guards', () => {
    it('every non-Plaits voice wrapper flushes its recursive state', () => {
        const calls: Record<string, RegExp[]> = {
            'emscripten/open303_wrapper.cpp': [/filter\.flushDenormals\(\);/],
            'emscripten/highfid303_wrapper.cpp': [/filter\.flushDenormals\(\);/, /feedbackHp\.flushDenormals\(\);/],
            'emscripten/prophecy_wrapper.cpp': [/voice\.flushDenormals\(\);/, /hyphon::flushDenormals\(x1, x2, y1, y2\)/],
            'emscripten/drumkit_wrapper.cpp': [/snare\.noiseBp\.flushDenormals\(\);/, /openHat\.bp\.flushDenormals\(\);/],
            'emscripten/jc303_wrapper.cpp': [/rosic_state::flushDenormals\(\*synth\);/, /hyphon::flushForNarrowing\(synth->getSample\(\)\)/],
        };
        for (const [file, patterns] of Object.entries(calls)) {
            const src = read(file);
            for (const re of patterns) expect(src, `${file} ${re}`).toMatch(re);
        }
    });

    it('jc303 reaches rosic state without patching the submodule', () => {
        const src = read('emscripten/jc303_wrapper.cpp');
        for (const member of ['previousOutput', 'feedbackHighpass', '&Elliptic::w']) {
            expect(src).toContain(member);
        }
    });

    it('the guard can be switched off only for the comparison build', () => {
        const voice = read('emscripten/core/voice.h');
        expect(voice).toMatch(/#ifndef HYPHON_DENORMAL_GUARD\n#define HYPHON_DENORMAL_GUARD 1/);
        expect(read('emscripten/build.sh')).not.toContain('HYPHON_DENORMAL_GUARD');
    });

    it('test:native runs the tail test for all five engines, guarded and not', () => {
        const runner = read('emscripten/tests/run_offline_voices_test.sh');
        expect(runner).toContain('for engine in OPEN303 JC303 HIGHFID303 PROPHECY DRUMKIT; do');
        expect(runner).toContain('-DHYPHON_DENORMAL_GUARD=$guard');
        expect(runner).toContain('--compare "$DENORMAL_DUMP"');
    });
});
