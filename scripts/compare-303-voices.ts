/**
 * Render the same ReBirth 303 patterns through many 303 voices and compare
 * them (#1543): null test, spectral difference, waveform and spectrum overlays.
 *
 *   pnpm run compare:303 -- [song.rbs ...] [options]
 *
 * With no song it uses test-fixtures/rbs/corpus/*.rbs (bash scripts/fetch-rbs-corpus.sh)
 * or, if that is empty, the committed test-fixtures/rbs/generated/*.rbs.
 * Output (default out/compare-303/): report.md, report.json, svg/*.svg, and
 * with --wav the renders as 32-bit float WAVs. Results and how to read them:
 * docs/audio-engine/303-voice-comparison.md.
 */

import { mkdirSync, readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RbsParser } from '../src/importers/rbs/RbsParser';
import {
  DEFAULT_PATTERN_SCRIPT_OPTIONS,
  patternToScript,
  selectRbsPatterns,
  type ParamMapping,
} from '../src/audio/offline/compare303/rbsSource';
import { overlaySvg, renderMarkdown, spectraSvg, summarize, meanMatrix } from '../src/audio/offline/compare303/report';
import { runCase, type CaseResult, type CompareCase } from '../src/audio/offline/compare303/run';
import {
  DEFAULT_REFERENCE_VOICE,
  resolveCompareVoices,
  type BackendPreference,
} from '../src/audio/offline/compare303/voices';
import { setupRunners } from './compare-303/runners';
import { float32Wav } from './compare-303/wav';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const USAGE = `Usage: pnpm run compare:303 -- [song.rbs ...] [options]

  --voices <list|all>     Comma list of registered 303 voice ids (default: all)
  --ref <id>              Reference voice (default: ${DEFAULT_REFERENCE_VOICE})
  --patterns <n>          Most-used patterns per 303 per song (default: 2)
  --pattern <list>        Exact patterns, e.g. A0,B3 (overrides --patterns)
  --loops <n>             Times each pattern repeats (default: ${DEFAULT_PATTERN_SCRIPT_OPTIONS.loops})
  --gate <0..1>           Note length as a fraction of a step (default: ${DEFAULT_PATTERN_SCRIPT_OPTIONS.gate})
  --tempo <bpm>           Override the song tempo
  --mapping <knob|import> Knob bytes / 127 for every voice, or the importer's SYNTH A mapping (default: knob)
  --backend <auto|native|ts>  open303-family renderer: native C++ if g++ is there (auto), or force one
  --openrb-wasm <path>    openrb338.wasm (default: openrb338/pkg/openrb338.wasm)
  --out <dir>             Output directory (default: out/compare-303)
  --wav                   Also write every render as a WAV
  -h, --help              This text`;

interface Args {
  songs: string[];
  voices: string[] | 'all';
  ref: string;
  perDevice: number;
  only: string[] | undefined;
  loops: number;
  gate: number;
  tempo: number | undefined;
  mapping: ParamMapping;
  backend: BackendPreference;
  openrbWasm: string;
  out: string;
  wav: boolean;
}

function parseArgs(argv: string[]): Args {
  const a: Args = {
    songs: [],
    voices: 'all',
    ref: DEFAULT_REFERENCE_VOICE,
    perDevice: 2,
    only: undefined,
    loops: DEFAULT_PATTERN_SCRIPT_OPTIONS.loops,
    gate: DEFAULT_PATTERN_SCRIPT_OPTIONS.gate,
    tempo: undefined,
    mapping: 'knob',
    backend: 'auto',
    openrbWasm: join(ROOT, 'openrb338/pkg/openrb338.wasm'),
    out: join(ROOT, 'out/compare-303'),
    wav: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = (): string => {
      const next = argv[++i];
      if (next === undefined || next.startsWith('--')) throw new Error(`${arg} needs a value`);
      return next;
    };
    const num = (): number => {
      const n = Number(value());
      if (!Number.isFinite(n)) throw new Error(`${arg} needs a number`);
      return n;
    };
    switch (arg) {
      case '--': break;
      case '-h':
      case '--help':
        console.log(USAGE);
        process.exit(0);
        break;
      case '--voices': { const v = value(); a.voices = v === 'all' ? 'all' : v.split(','); break; }
      case '--ref': a.ref = value(); break;
      case '--patterns': a.perDevice = num(); break;
      case '--pattern': a.only = value().split(','); break;
      case '--loops': a.loops = num(); break;
      case '--gate': a.gate = num(); break;
      case '--tempo': a.tempo = num(); break;
      case '--mapping': {
        const v = value();
        if (v !== 'knob' && v !== 'import') throw new Error('--mapping must be knob or import');
        a.mapping = v;
        break;
      }
      case '--backend': {
        const v = value();
        if (v !== 'auto' && v !== 'native' && v !== 'ts') throw new Error('--backend must be auto, native or ts');
        a.backend = v;
        break;
      }
      case '--openrb-wasm': a.openrbWasm = resolve(value()); break;
      case '--out': a.out = resolve(value()); break;
      case '--wav': a.wav = true; break;
      default:
        if (arg.startsWith('-')) throw new Error(`unknown option ${arg}`);
        a.songs.push(arg);
    }
  }
  return a;
}

function defaultSongs(): string[] {
  for (const dir of ['test-fixtures/rbs/corpus', 'test-fixtures/rbs/generated']) {
    const full = join(ROOT, dir);
    const files = existsSync(full) ? readdirSync(full).filter((f) => f.endsWith('.rbs')).sort() : [];
    if (files.length) return files.map((f) => join(full, f));
  }
  return [];
}

async function buildCases(args: Args): Promise<CompareCase[]> {
  const songs = args.songs.length ? args.songs.map((s) => resolve(s)) : defaultSongs();
  if (!songs.length) throw new Error('no .rbs files: pass some, or run bash scripts/fetch-rbs-corpus.sh');
  const cases: CompareCase[] = [];
  for (const song of songs) {
    const name = basename(song, extname(song));
    const parsed = await new RbsParser().parseBytes(new Uint8Array(readFileSync(song)), { filename: `${name}.rbs` });
    if (!parsed.success) {
      console.warn(`skip ${name}: ${JSON.stringify(parsed.error)}`);
      continue;
    }
    const raw = parsed.data;
    const tempo = args.tempo ?? (raw.project.tempo > 0 ? raw.project.tempo : 130);
    for (const pattern of selectRbsPatterns(raw, args.perDevice, args.only)) {
      cases.push({
        id: `${name}#${pattern.device}${pattern.slot}`,
        song: name,
        pattern: { device: pattern.device, slot: pattern.slot, uses: pattern.uses, notes: pattern.notes },
        tempo,
        script: patternToScript(pattern.pattern, {
          ...DEFAULT_PATTERN_SCRIPT_OPTIONS,
          tempo,
          loops: args.loops,
          gate: args.gate,
          mapping: args.mapping,
        }),
      });
    }
  }
  return cases;
}

const fileSafe = (s: string): string => s.replace(/[^A-Za-z0-9_.#-]/g, '_').replace(/#/g, '-');

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const cases = await buildCases(args);
  if (!cases.length) throw new Error('no non-silent 303 patterns found');

  const { runners, notes } = await setupRunners({
    root: ROOT,
    cacheDir: join(ROOT, 'node_modules/.cache/compare303'),
    openrbWasm: args.openrbWasm,
    native: args.backend !== 'ts',
  });
  for (const note of notes) console.log(`· ${note}`);

  let voices = resolveCompareVoices(runners, args.backend);
  if (args.voices !== 'all') {
    const wanted = args.voices;
    const unknown = wanted.filter((id) => !voices.some((v) => v.id === id));
    if (unknown.length) throw new Error(`unknown voice(s): ${unknown.join(', ')}`);
    voices = voices.filter((v) => wanted.includes(v.id));
  }
  if (!voices.some((v) => v.id === args.ref && v.backend)) {
    const fallback = voices.find((v) => v.backend);
    if (!fallback) throw new Error('no voice is available to render');
    console.warn(`reference ${args.ref} unavailable, using ${fallback.id}`);
    args.ref = fallback.id;
  }

  mkdirSync(join(args.out, 'svg'), { recursive: true });
  const results: CaseResult[] = [];
  for (const c of cases) {
    const t0 = Date.now();
    const result = await runCase(c, voices, runners, args.ref);
    results.push(result);
    writeFileSync(join(args.out, 'svg', `${fileSafe(c.id)}-overlay.svg`), overlaySvg(result));
    writeFileSync(join(args.out, 'svg', `${fileSafe(c.id)}-spectra.svg`), spectraSvg(result));
    if (args.wav) {
      const dir = join(args.out, 'wav', fileSafe(c.id));
      mkdirSync(dir, { recursive: true });
      for (const r of result.results) writeFileSync(join(dir, `${r.voice.id}.wav`), float32Wav(r.signal, c.script.sampleRate));
    }
    console.log(`${c.id}: ${result.results.length} voices in ${Date.now() - t0} ms`);
  }

  const skipped = [...new Map(results.flatMap((r) => r.skipped).map((s) => [s.id, s])).values()].concat(
    voices.filter((v) => !v.backend).map((v) => ({ id: v.id, reason: v.unavailableReason ?? 'unavailable' })),
  );
  const uniqueSkipped = [...new Map(skipped.map((s) => [s.id, s])).values()];
  const settings = {
    sampleRate: cases[0].script.sampleRate,
    mapping: args.mapping,
    loops: args.loops,
    gate: args.gate,
    backendPreference: args.backend,
    referenceId: args.ref,
  };
  writeFileSync(join(args.out, 'report.md'), renderMarkdown(results, settings, uniqueSkipped));
  writeFileSync(
    join(args.out, 'report.json'),
    JSON.stringify(
      {
        settings,
        notes,
        skipped: uniqueSkipped,
        summary: summarize(results),
        matrix: meanMatrix(results),
        cases: results.map((r) => ({
          id: r.case.id,
          song: r.case.song,
          pattern: r.case.pattern,
          tempo: r.case.tempo,
          seconds: r.case.script.totalFrames / r.case.script.sampleRate,
          voices: r.results.map((v) => ({
            id: v.voice.id,
            backend: v.voice.backend,
            standInFor: v.voice.standInFor,
            renderMs: Math.round(v.renderMs),
            rmsDbfs: 20 * Math.log10(Math.max(v.analysis.rms, 1e-12)),
            peak: v.analysis.peak,
            centroidHz: v.analysis.centroidHz,
            vsReference: v.vsReference ?? null,
          })),
        })),
      },
      null,
      2,
    ),
  );
  console.log(`\nwrote ${join(args.out, 'report.md')}`);
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
