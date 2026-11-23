/**
 * Guard: nothing in src/ loads an asset from a root-absolute path.
 *
 * The app is hosted under a subdirectory (`/hyphon/`) and built with
 * `base: './'` (docs/deployment/DEPLOYMENT_CONFIG.md), so `fetch('/x.wasm')`,
 * `new Worker('/x.js')` or `audioWorklet.addModule('/x.js')` resolve against the
 * host root and 404 in production while working on the dev server. Every
 * runtime URL goes through `import.meta.env.BASE_URL` (or a `?url` / `?worker`
 * import, which Vite rebases).
 *
 * Flags a string literal that starts with `/` and is
 *   - the first argument of fetch / Worker / SharedWorker / addModule / importScripts /
 *     new Audio / new Image().src-style loaders, or
 *   - an asset path (`/name.ext`, `/dir/name.ext`) assigned or passed anywhere
 *     else, unless it is allow-listed below with the reason it is safe.
 * Tests, comments and `import ... from '/...'` module specifiers are ignored.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = path.resolve(__dirname, '..');
const SELF = path.resolve(__filename);

/** file (relative to src/) → literals that are rebased before use. */
const ALLOWED: Record<string, readonly string[]> = {
    // Stored as '/osc/x.webp'; oscillatorPanelImageUrl() strips the slash and prefixes BASE_URL.
    'components/oscillatorThemes.ts': ['/osc/'],
};

const LOADER_CALL = /\b(?:fetch|Worker|SharedWorker|addModule|importScripts|Audio|loadPyodide)\(\s*[`'"]\/(?!\/)/;
const ASSET_LITERAL = /[`'"]\/(?!\/)[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*\.(?:wasm|wav|mp3|ogg|webp|png|jpe?g|svg|json|onnx|js|mjs|css|html)[`'"]/;

function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) {
            if (name === '__tests__' || name === 'test' || name === 'wasm') continue;
            walk(full, out);
        } else if (/\.(ts|tsx)$/.test(name) && !/\.(test|spec|bench)\./.test(name) && !name.endsWith('.d.ts')) {
            out.push(full);
        }
    }
    return out;
}

function isCommentOrImport(line: string): boolean {
    const t = line.trim();
    return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') || /^(import|export)\b.*\bfrom\s+['"]/.test(t);
}

describe('no root-absolute asset paths in src/', () => {
    it('loads every runtime asset through import.meta.env.BASE_URL', () => {
        const offences: string[] = [];
        for (const file of walk(SRC)) {
            if (path.resolve(file) === SELF) continue;
            const rel = path.relative(SRC, file).split(path.sep).join('/');
            const allowed = ALLOWED[rel] ?? [];
            readFileSync(file, 'utf8')
                .split('\n')
                .forEach((line, i) => {
                    if (isCommentOrImport(line)) return;
                    if (allowed.some((a) => line.includes(`'${a}`) || line.includes(`"${a}`) || line.includes(`\`${a}`))) return;
                    if (LOADER_CALL.test(line) || ASSET_LITERAL.test(line)) {
                        offences.push(`${rel}:${i + 1}: ${line.trim()}`);
                    }
                });
        }
        expect(offences, `root-absolute asset path(s) — use import.meta.env.BASE_URL:\n${offences.join('\n')}`).toEqual([]);
    });
});
