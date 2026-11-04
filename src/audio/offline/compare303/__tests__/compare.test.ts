import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RbsParser } from '../../../../importers/rbs/RbsParser';
import { TB303_MODELS } from '../../../../engines/TB303Models';
import { instantiateOpenrb338, renderOpenrb338 } from '../openrb338Voice';
import { DEFAULT_PATTERN_SCRIPT_OPTIONS, patternToScript, selectRbsPatterns } from '../rbsSource';
import { renderMarkdown, summarize, overlaySvg, spectraSvg } from '../report';
import { runCase, type CompareCase } from '../run';
import { renderCompareVoice, resolveCompareVoices, type BackendRunners } from '../voices';

const ROOT = resolve(__dirname, '../../../../..');
const FIXTURE = resolve(ROOT, 'test-fixtures/rbs/generated/generated_v20_pattern_mode.rbs');
const OPENRB_WASM = resolve(ROOT, 'openrb338/pkg/openrb338.wasm');

async function fixtureCase(loops = 1): Promise<CompareCase> {
  const parsed = await new RbsParser().parseBytes(new Uint8Array(readFileSync(FIXTURE)), { filename: 'f.rbs' });
  if (!parsed.success) throw new Error('fixture does not parse');
  const [pattern] = selectRbsPatterns(parsed.data, 1);
  const tempo = parsed.data.project.tempo;
  return {
    id: 'fixture#A0',
    song: 'fixture',
    tempo,
    pattern: { device: pattern.device, slot: pattern.slot, uses: pattern.uses, notes: pattern.notes },
    script: patternToScript(pattern.pattern, { ...DEFAULT_PATTERN_SCRIPT_OPTIONS, tempo, loops }),
  };
}

describe('resolveCompareVoices', () => {
  it('covers every registered 303 voice exactly once', () => {
    const voices = resolveCompareVoices({});
    expect(voices.map((v) => v.id)).toEqual(TB303_MODELS.map((m) => m.id));
  });

  it('needs no Node backend for the open303 profiles and the diode ladder', () => {
    const by = Object.fromEntries(resolveCompareVoices({}).map((v) => [v.id, v]));
    expect(by['stock-open303'].backend).toBe('ts-open303');
    expect(by['rebirth-2.0'].backend).toBe('ts-open303');
    expect(by['highfid-cpu'].backend).toBe('ts-highfid');
    // live-highfid and gpu-highfid render through the CPU diode ladder, and say so
    expect(by['live-highfid']).toMatchObject({ backend: 'ts-highfid', standInFor: 'live-highfid' });
    expect(by['gpu-highfid']).toMatchObject({ backend: 'ts-highfid', standInFor: 'gpu-highfid' });
    expect(by['highfid-cpu'].standInFor).toBeUndefined();
  });

  it('reports jc303 and openrb-338 unavailable with a reason instead of substituting another voice', () => {
    const by = Object.fromEntries(resolveCompareVoices({}).map((v) => [v.id, v]));
    expect(by['jc303'].backend).toBeNull();
    expect(by['jc303'].unavailableReason).toMatch(/jc303_wasm/);
    for (const id of ['openrb338-vintage', 'openrb338-2.0']) {
      expect(by[id].backend).toBeNull();
      expect(by[id].unavailableReason).toMatch(/build:wasm:openrb338/);
    }
  });

  it('routes to the injected runners and honours the backend preference', () => {
    const runners: BackendRunners = {
      nativeOpen303: () => Promise.resolve(new Float32Array(0)),
      nativeJc303: () => Promise.resolve(new Float32Array(0)),
      openrb338: () => Promise.resolve(new Float32Array(0)),
    };
    const auto = Object.fromEntries(resolveCompareVoices(runners).map((v) => [v.id, v.backend]));
    expect(auto['stock-open303']).toBe('native-open303');
    expect(auto['jc303']).toBe('native-jc303');
    expect(auto['openrb338-2.0']).toBe('openrb338-wasm');
    const ts = Object.fromEntries(resolveCompareVoices(runners, 'ts').map((v) => [v.id, v.backend]));
    expect(ts['stock-open303']).toBe('ts-open303');
    const forcedNative = Object.fromEntries(resolveCompareVoices({}, 'native').map((v) => [v.id, v.backend]));
    expect(forcedNative['stock-open303']).toBeNull();
  });
});

describe('runCase on a committed RBS fixture (TS backends)', () => {
  it('renders every available voice deterministically and compares it to the reference', async () => {
    const c = await fixtureCase();
    const voices = resolveCompareVoices({});
    const result = await runCase(c, voices, {}, 'stock-open303');

    const rendered = result.results.map((r) => r.voice.id);
    expect(rendered).toEqual(expect.arrayContaining(['stock-open303', 'rebirth-2.0', 'highfid-cpu']));
    expect(result.skipped.map((s) => s.id)).toEqual(expect.arrayContaining(['jc303', 'openrb338-2.0']));
    for (const r of result.results) {
      expect(r.signal).toHaveLength(c.script.totalFrames);
      expect(r.analysis.silent).toBe(false);
    }

    const stock = result.results.find((r) => r.voice.id === 'stock-open303')!;
    expect(stock.vsReference).toBeUndefined();
    const hf = result.results.find((r) => r.voice.id === 'highfid-cpu')!;
    expect(hf.vsReference).toBeDefined();
    expect(Number.isFinite(hf.vsReference!.nullDb)).toBe(true);

    // live-highfid and highfid-cpu are the same engine: zero spectral distance
    const i = rendered.indexOf('live-highfid');
    const j = rendered.indexOf('highfid-cpu');
    expect(result.matrix[i][j]).toBe(0);

    // deterministic
    const again = await renderCompareVoice(hf.voice, c.script, {});
    expect(Array.from(again.subarray(0, 4096))).toEqual(Array.from(hf.signal.subarray(0, 4096)));
  });

  it('writes a report with every case and voice, and non-empty SVGs', async () => {
    const c = await fixtureCase();
    const result = await runCase(c, resolveCompareVoices({}), {}, 'stock-open303');
    const settings = { sampleRate: 44100, mapping: 'knob', loops: 1, gate: 0.6, backendPreference: 'auto', referenceId: 'stock-open303' };
    const md = renderMarkdown([result], settings, result.skipped);
    expect(md).toContain('# 303 voice comparison');
    expect(md).toContain('fixture#A0');
    expect(md).toContain('| rebirth-2.0 |');
    expect(md).toContain('jc303');
    expect(summarize([result]).find((s) => s.id === 'rebirth-2.0')?.cases).toBe(1);
    expect(overlaySvg(result)).toContain('<path');
    expect(spectraSvg(result)).toContain('average spectrum');
  });
});

// The openrb-338 build is opt-in (GPL-3.0-only, `pnpm run build:wasm:openrb338`), so it is not in a plain checkout.
describe.runIf(existsSync(OPENRB_WASM))('openrb-338 wasm voice', () => {
  it('renders both ReBirth modes through the harness: gated, finite, and different from each other', async () => {
    const exports = await instantiateOpenrb338(readFileSync(OPENRB_WASM));
    const c = await fixtureCase();
    const vintage = renderOpenrb338(exports, 'vintage', c.script);
    const v2 = renderOpenrb338(exports, 'v2', c.script);
    const again = renderOpenrb338(exports, 'v2', c.script);

    expect(Array.from(again)).toEqual(Array.from(v2)); // deterministic
    expect(vintage.every(Number.isFinite)).toBe(true);
    expect(vintage.some((v) => Math.abs(v) > 1e-3)).toBe(true);
    let differs = false;
    for (let i = 0; i < v2.length && !differs; i++) differs = vintage[i] !== v2[i];
    expect(differs).toBe(true);

    const runners: BackendRunners = {
      openrb338: (mode, script) => Promise.resolve(renderOpenrb338(exports, mode, script)),
    };
    const result = await runCase(c, resolveCompareVoices(runners), runners, 'openrb338-2.0');
    expect(result.referenceId).toBe('openrb338-2.0');
    const vs = result.results.find((r) => r.voice.id === 'stock-open303')?.vsReference;
    expect(vs).toBeDefined();
    expect(Number.isFinite(vs!.lsdDb)).toBe(true);
  });
});
