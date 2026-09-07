/**
 * Guard: every audioWorklet.addModule call site must resolve a bundler-emitted URL,
 * not a raw .ts/.tsx path (which Vite serves in dev but never emits in dist/).
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
    } else if (entry.isFile() && /\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const RAW_TS_ADD_MODULE = /addModule\s*\(\s*['"`][^'"`]*\.tsx?['"`]/;
const RAW_TS_NEW_URL = /new\s+URL\s*\(\s*['"`][^'"`]*audio-worklets\/[^'"`]*\.tsx?['"`]/;

describe('audioWorklet.addModule URLs', () => {
  it('no call site passes a raw .ts/.tsx path to addModule or via new URL(audio-worklets/...)', () => {
    const violations: string[] = [];

    for (const file of walkTsFiles(srcDir)) {
      const rel = path.relative(repoRoot, file);
      const content = fs.readFileSync(file, 'utf8');
      if (!content.includes('addModule')) continue;

      if (RAW_TS_ADD_MODULE.test(content)) {
        violations.push(`${rel}: addModule with raw .ts/.tsx string literal`);
      }
      if (RAW_TS_NEW_URL.test(content)) {
        violations.push(`${rel}: new URL(...audio-worklets/*.ts) worklet path`);
      }
    }

    expect(violations).toEqual([]);
  });
});
