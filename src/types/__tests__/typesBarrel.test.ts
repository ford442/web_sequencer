/**
 * `src/types.ts` shadows `src/types/` for extensionless `@/types` imports, so
 * it must stay a pure re-export barrel. #1303 was merged from a pre-split base
 * and silently restored the 750-line monolith, so every `@/types` import saw
 * stale definitions (`rust-*` waveforms, no `model303Extra`) and `tsc -b`
 * failed on main. Domain types belong in `src/types/*`.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const BARREL = resolve(__dirname, '../../types.ts');

describe('src/types.ts barrel', () => {
    it('contains only `export * from ./types/*` re-exports', () => {
        const code = readFileSync(BARREL, 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .split('\n')
            .map((line) => line.replace(/\/\/.*$/, '').trim())
            .filter(Boolean);
        expect(code.length).toBeGreaterThan(0);
        for (const line of code) {
            expect(line).toMatch(/^export \* from '\.\/types\/[\w-]+';$/);
        }
    });
});
