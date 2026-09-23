/**
 * Guard: the only hyphon_native heap a voice may touch is the one the
 * AudioWorklet session imports (#1229). The deleted `src/engines/AudioDSP.ts`
 * (`window.Module` + `window.AudioDSP`, `Open303Native`, `hasOpen303Native`)
 * drove `_malloc` / `open303_create` / `mixBuffers` on the main-thread glue —
 * a second instance fighting the worklet's imported memory, and on the
 * single-threaded (WebKit / non-COOP) build the DSP helpers aren't even linked.
 *
 * Allowlist: `src/audio-worklets/**` (the worklet session and
 * `hyphonNativeImports`). `main.tsx` / `App.tsx` load / probe the glue for the
 * Pyodide bootstrap only and are checked for voice/DSP symbols like
 * everything else.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const srcDir = path.join(repoRoot, 'src');

function walkTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
      out.push(...walkTsFiles(full));
    } else if (entry.isFile() && /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const rel = (file: string) => path.relative(repoRoot, file).split(path.sep).join('/');

/** `window.Module`, `globalThis.Module`, `self['Module']`, `(window as X).Module`. */
const GLOBAL_MODULE_ACCESS = [
  /\b(?:window|globalThis|self)\s*(?:\?\.|\.)\s*Module\b/,
  /\b(?:window|globalThis|self)\s*\[\s*['"`]Module['"`]\s*\]/,
  /\b(?:window|globalThis|self)\s+as\b[^;]*?\)\s*(?:\?\.|\.)\s*Module\b/,
];

const WINDOW_AUDIO_DSP = /\b(?:window|globalThis|self)\b[^;\n]*\.\s*AudioDSP\b/;

/** Voice + DSP exports of hyphon_native; only the worklet session may call these. */
const NATIVE_VOICE_SYMBOL =
  /\bModule\b[^;\n]*?\.\s*_?(?:open303_|prophecy_|drumkit_|highfid303_|jc303_|applyGain\b|mixBuffers\b|mixVoiceBuffers\b|applyStereoWidth\b|findPeak\b|malloc\b|free\b)/;

const isWorkletSession = (file: string) => rel(file).startsWith('src/audio-worklets/');

describe('main-thread hyphon_native guard', () => {
  const files = walkTsFiles(srcDir);

  it('no src/engines/** file reads a global Module or window.AudioDSP', () => {
    const violations: string[] = [];
    for (const file of files) {
      if (!rel(file).startsWith('src/engines/')) continue;
      const content = fs.readFileSync(file, 'utf8');
      if (GLOBAL_MODULE_ACCESS.some((re) => re.test(content))) {
        violations.push(`${rel(file)}: reads the main-thread global Module`);
      }
      if (WINDOW_AUDIO_DSP.test(content)) {
        violations.push(`${rel(file)}: reads window.AudioDSP`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('outside the worklet session, nothing calls 303/Prophecy/drumkit/DSP exports on Module', () => {
    const violations: string[] = [];
    for (const file of files) {
      if (isWorkletSession(file)) continue;
      const content = fs.readFileSync(file, 'utf8');
      if (NATIVE_VOICE_SYMBOL.test(content)) {
        violations.push(rel(file));
      }
    }
    expect(violations).toEqual([]);
  });

  it('the deleted shadow stack stays deleted', () => {
    expect(fs.existsSync(path.join(srcDir, 'engines/AudioDSP.ts'))).toBe(false);
    const importers: string[] = [];
    for (const file of files) {
      const content = fs.readFileSync(file, 'utf8');
      if (/from\s+['"][^'"]*\/AudioDSP['"]|\b(?:Open303Native|hasOpen303Native)\b/.test(content)) {
        importers.push(rel(file));
      }
    }
    expect(importers).toEqual([]);
  });

  it('the patterns catch the shapes the deleted bridge used', () => {
    const samples = [
      'const m = window.Module;',
      "const m = (window as unknown as { Module: X }).Module;",
      "globalThis['Module']._malloc(4)",
    ];
    for (const sample of samples) {
      expect(GLOBAL_MODULE_ACCESS.some((re) => re.test(sample)), sample).toBe(true);
    }
    expect(NATIVE_VOICE_SYMBOL.test('Module._open303_create()')).toBe(true);
    expect(NATIVE_VOICE_SYMBOL.test('this.Module._applyGain(ptr, n, 2, g)')).toBe(true);
    expect(WINDOW_AUDIO_DSP.test('(window as any).AudioDSP = new X()')).toBe(true);
    expect(GLOBAL_MODULE_ACCESS.some((re) => re.test('WebAssembly.Module.imports(m)'))).toBe(false);
  });
});
