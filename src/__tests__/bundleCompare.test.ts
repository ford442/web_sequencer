import { describe, expect, it } from 'vitest';
// @ts-expect-error -- scripts/*.mjs has no project-referenced types
import * as bundleCompareModule from '../../scripts/bundle-compare.mjs';

interface Entry { name: string; before: number; after: number; delta: number }
interface Budget { label: string; max: number; before: number; after: number; headroom: number; over: boolean }
interface Comparison {
  files: { grown: Entry[]; shrunk: Entry[]; added: Entry[]; removed: Entry[] };
  aggregate: { assetsRaw: { before: number; after: number } };
  budgets: Budget[];
}
const { compareReports, formatComparison, stableName } = bundleCompareModule as unknown as {
  compareReports: (base: object, head: object, budget: object) => Comparison;
  formatComparison: (cmp: Comparison) => string;
  stableName: (file: string) => string;
};

const base = {
  entry: 'assets/index-AAAAAAAA.js',
  rows: [{ file: 'assets/index-AAAAAAAA.js', raw: 1000, gzip: 400, brotli: 300, eager: true }],
  assets: [
    { file: 'assets/index-AAAAAAAA.js', raw: 1000, brotli: 300 },
    { file: 'assets/Studio3D-BBBBBBBB.js', raw: 800, brotli: 200 },
    { file: 'assets/old-CCCCCCCC.js', raw: 50, brotli: 20 },
    { file: 'assets/steady-DDDDDDDD.css', raw: 70, brotli: 30 },
    { file: 'assets/shrinks-EEEEEEEE.js', raw: 500, brotli: 100 },
  ],
};
const head = {
  entry: 'assets/index-ZZZZZZZZ.js',
  rows: [{ file: 'assets/index-ZZZZZZZZ.js', raw: 1100, gzip: 440, brotli: 330, eager: true }],
  assets: [
    { file: 'assets/index-ZZZZZZZZ.js', raw: 1100, brotli: 330 },
    { file: 'assets/Studio3D-YYYYYYYY.js', raw: 800, brotli: 200 },
    { file: 'assets/new-XXXXXXXX.js', raw: 300, brotli: 90 },
    { file: 'assets/steady-DDDDDDDD.css', raw: 70, brotli: 30 },
    { file: 'assets/shrinks-WWWWWWWW.js', raw: 400, brotli: 80 },
  ],
};
const budget = { assetsDirMaxBytes: 2400, entryChunkMaxBytes: 2000, compressed: { assetsDirMaxBytes: 800 } };

describe('bundle compare', () => {
  it('strips content hashes so renamed chunks line up', () => {
    expect(stableName('assets/Studio3D-B3MEUl4B.js')).toBe('assets/Studio3D.js');
    expect(stableName('assets/index-lICDhzw3.css')).toBe('assets/index.css');
    expect(stableName('assets/vowels/ah.wav')).toBe('assets/vowels/ah.wav');
  });

  it('classifies grown / shrunk / new / removed and ignores unchanged files', () => {
    const { files } = compareReports(base, head, budget);
    expect(files.grown.map((f) => f.name)).toEqual(['assets/index.js']);
    expect(files.grown[0].delta).toBe(100);
    expect(files.shrunk.map((f) => f.name)).toEqual(['assets/shrinks.js']);
    expect(files.added.map((f) => f.name)).toEqual(['assets/new.js']);
    expect(files.removed.map((f) => f.name)).toEqual(['assets/old.js']);
  });

  it('aggregates against each budget row', () => {
    const { aggregate, budgets } = compareReports(base, head, budget);
    expect(aggregate.assetsRaw).toEqual({ before: 2420, after: 2670 });
    const raw = budgets.find((b) => b.label.startsWith('dist/assets total, raw'));
    expect(raw).toMatchObject({ max: 2400, after: 2670, headroom: -270, over: true });
    const br = budgets.find((b) => b.label.startsWith('dist/assets total, brotli'));
    expect(br).toMatchObject({ max: 800, after: 730, headroom: 70, over: false });
  });

  it('renders markdown and flags over-budget rows', () => {
    const text = formatComparison(compareReports(base, head, budget));
    expect(text).toContain('**OVER by 270**');
    expect(text).toContain('### New (1)');
    expect(text).toContain('| assets/new.js | 0 | 300 | +300 |');
  });
});
