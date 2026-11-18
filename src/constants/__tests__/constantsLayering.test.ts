/**
 * `src/constants.ts` folded into `src/constants/` (#1597 P2) without an
 * import cycle through `src/engines`: the barrel re-exports
 * `instrumentDefaults.ts`, which imports engine modules (kit presets, TB-303
 * voice fields), so engine code must import the leaf module it needs, never
 * the barrel; and no other leaf may import engine code.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = resolve(__dirname, '../..');
const CONSTANTS = join(SRC, 'constants');
const ENGINES = join(SRC, 'engines');

function sources(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) return name === '__tests__' ? [] : sources(full);
        return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
    });
}

const imports = (file: string) =>
    [...readFileSync(file, 'utf8').matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);

describe('constants layering', () => {
    it('engine code never imports the constants barrel', () => {
        const offenders = sources(ENGINES).flatMap((file) =>
            imports(file)
                .filter((spec) => /(^|\/)constants$/.test(spec) && !spec.startsWith('./'))
                .map((spec) => `${relative(SRC, file)} imports '${spec}'`),
        );
        expect(offenders, 'import the leaf, e.g. ../constants/tuning').toEqual([]);
    });

    it('only instrumentDefaults.ts imports engine code', () => {
        const offenders = sources(CONSTANTS)
            .filter((file) => !file.endsWith('instrumentDefaults.ts'))
            .flatMap((file) => imports(file).filter((spec) => spec.includes('engines')).map((spec) => `${relative(SRC, file)} imports '${spec}'`));
        expect(offenders).toEqual([]);
    });

    it('the old single-file module is gone', () => {
        expect(() => statSync(join(SRC, 'constants.ts'))).toThrow();
    });
});
