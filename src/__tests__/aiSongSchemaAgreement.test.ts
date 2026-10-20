/**
 * The JSON Schema, the TypeScript validator and the importer must agree.
 *
 * `docs/schemas/ai-song.schema.json` is what an agent is handed;
 * `validateAISongData()` + `AISongImporter` (strict) is what the app runs. This
 * file pins them to one another and to the fixtures:
 *
 *  - every `test-fixtures/ai-song/*.json` passes both;
 *  - every input in `BAD_FOR_BOTH` fails both;
 *  - the rules a JSON Schema cannot express (`IMPORTER_ONLY`) and the unknown
 *    keys only the schema rejects (`SCHEMA_ONLY`) are listed explicitly, so a
 *    gap cannot open silently.
 *
 * The importer runs in `strict` mode — the mode `ai-song:render` and agents use —
 * so a dropped note or an unplayed lane counts as a failure, the way the schema
 * counts it.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';

import { AISongImporter, type AISongData } from '../importers/ai-song';
import { validateAISongData } from '../importers/ai-song/types';

const ROOT = process.cwd();
const FIXTURE_DIR = resolve(ROOT, 'test-fixtures/ai-song');

const ajv = new Ajv2020({ allErrors: false, strict: true });
addFormats(ajv);
const schema = JSON.parse(readFileSync(resolve(ROOT, 'docs/schemas/ai-song.schema.json'), 'utf8')) as object;
const validateSchema = ajv.compile(schema);

type Json = any;

const load = (file: string): Json => JSON.parse(readFileSync(resolve(FIXTURE_DIR, file), 'utf8'));
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function bySchema(data: unknown): boolean {
  return validateSchema(data);
}

function byCode(data: unknown): boolean {
  if (!validateAISongData(data).valid) return false;
  return new AISongImporter().convert(data as AISongData, { strict: true }).success;
}

const fixtures = readdirSync(FIXTURE_DIR).filter((f) => f.endsWith('.json'));

describe('fixtures pass both the schema and the importer', () => {
  it('finds the fixtures', () => {
    expect(fixtures).toEqual(expect.arrayContaining(['minimal.json', 'full.json', 'song-mode.json']));
  });

  it.each(fixtures)('%s', (file) => {
    const data = load(file);
    expect(bySchema(data), JSON.stringify(validateSchema.errors)).toBe(true);
    expect(byCode(data)).toBe(true);
  });
});

describe('the agent brief', () => {
  const brief = readFileSync(resolve(ROOT, 'docs/ai-song-agent-brief.md'), 'utf8');

  it('stays prompt-sized', () => {
    expect(brief.split('\n').length).toBeLessThanOrEqual(150);
  });

  it('has an example that passes both the schema and the importer', () => {
    const block = /```json\n([\s\S]*?)\n```/.exec(brief)?.[1];
    expect(block, 'the brief needs a ```json example').toBeTruthy();
    const example = JSON.parse(block!) as Json;
    expect(bySchema(example), JSON.stringify(validateSchema.errors)).toBe(true);
    expect(byCode(example)).toBe(true);
  });
});

type Mutation = [name: string, base: string, mutate: (song: Json) => void];

/** Each of these is rejected by the schema AND by the validator / strict importer. */
const BAD_FOR_BOTH: Mutation[] = [
  ['tempo below 30', 'minimal.json', (s) => { s.globals.tempo = 29; }],
  ['tempo above 300', 'minimal.json', (s) => { s.globals.tempo = 301; }],
  ['tempo is a string', 'minimal.json', (s) => { s.globals.tempo = '120'; }],
  ['swing above 100', 'full.json', (s) => { s.globals.swing = 101; }],
  ['swing below 0', 'full.json', (s) => { s.globals.swing = -1; }],
  ['timeSignature of one number', 'full.json', (s) => { s.globals.timeSignature = [4]; }],
  ['timeSignature numerator 0', 'full.json', (s) => { s.globals.timeSignature = [0, 4]; }],
  ['timeSignature fractional', 'full.json', (s) => { s.globals.timeSignature = [3.5, 4]; }],
  ['unknown version', 'minimal.json', (s) => { s.meta.version = '2.0'; }],
  ['missing meta', 'minimal.json', (s) => { delete s.meta; }],
  ['missing globals', 'minimal.json', (s) => { delete s.globals; }],
  ['missing meta.author', 'minimal.json', (s) => { delete s.meta.author; }],
  ['blank meta.generator', 'minimal.json', (s) => { s.meta.generator = '   '; }],
  ['empty meta.prompt', 'minimal.json', (s) => { s.meta.prompt = ''; }],
  ['title over 100 chars', 'minimal.json', (s) => { s.meta.title = 'x'.repeat(101); }],
  ['v1.0 without tracks', 'minimal.json', (s) => { delete s.tracks; }],
  ['v1.0 with a song block', 'minimal.json', (s) => { s.patterns = { A: { tracks: {} } }; s.song = [{}]; }],
  ['v1.0 with stepCount', 'minimal.json', (s) => { s.globals.stepCount = 16; }],
  ['note name H4', 'minimal.json', (s) => { s.tracks.synthA.notes[0].note = 'H4'; }],
  ['note octave 9', 'minimal.json', (s) => { s.tracks.synthA.notes[0].note = 'C9'; }],
  ['note with lowercase name', 'minimal.json', (s) => { s.tracks.synthA.notes[0].note = 'c4'; }],
  ['note step below 0', 'minimal.json', (s) => { s.tracks.synthA.notes[0].step = -1; }],
  ['note missing its note', 'minimal.json', (s) => { delete s.tracks.synthA.notes[0].note; }],
  ['sampler bankIndex 8', 'full.json', (s) => { s.tracks.sampler[0].bankIndex = 8; }],
  ['lane with an unknown target', 'full.json', (s) => { s.automation[0].target = 'lead'; }],
  ['lane parameter foreign to its target', 'full.json', (s) => { s.automation[0].target = 'kick'; s.automation[0].parameter = 'filterCutoff'; }],
  ['master volume (not masterVolume)', 'full.json', (s) => { s.automation[0].target = 'master'; s.automation[0].parameter = 'volume'; }],
  ['lane value above 127', 'full.json', (s) => { s.automation[0].steps[0] = 128; }],
  ['lane value below 0', 'full.json', (s) => { s.automation[0].steps[0] = -1; }],
  ['lane value is a string', 'full.json', (s) => { s.automation[0].steps[0] = '64'; }],
  ['unknown interpolation', 'full.json', (s) => { s.automation[0].interpolation = 'cubic'; }],
  ['v1.1 with tracks and patterns', 'song-mode.json', (s) => { s.tracks = { kick: [true] }; }],
  ['v1.1 with neither tracks nor patterns', 'song-mode.json', (s) => { delete s.patterns; delete s.song; }],
  ['v1.1 patterns without song', 'song-mode.json', (s) => { delete s.song; }],
  ['v1.1 empty song', 'song-mode.json', (s) => { s.song = []; }],
  ['v1.1 empty patterns', 'song-mode.json', (s) => { s.patterns = {}; }],
  ['v1.1 stepCount 0', 'song-mode.json', (s) => { s.globals.stepCount = 0; }],
  ['v1.1 stepCount 65', 'song-mode.json', (s) => { s.globals.stepCount = 65; }],
  ['v1.1 stepCount fractional', 'song-mode.json', (s) => { s.globals.stepCount = 16.5; }],
  ['v1.1 song row naming an unknown track', 'song-mode.json', (s) => { s.song[0].bassoon = 'intro'; }],
];

describe('known-bad inputs fail both the schema and the importer', () => {
  it.each(BAD_FOR_BOTH)('%s', (_name, base, mutate) => {
    const song = clone(load(base));
    expect(bySchema(song), 'precondition: the base fixture is valid').toBe(true);
    mutate(song);
    expect(bySchema(song), 'schema should reject').toBe(false);
    expect(byCode(song), 'validator / strict importer should reject').toBe(false);
  });
});

/**
 * Rules a JSON Schema cannot state: they depend on another part of the same
 * document. The schema accepts these; the validator must not.
 */
const IMPORTER_ONLY: Mutation[] = [
  ['lane length differs from the pattern length', 'full.json', (s) => { s.automation[0].steps.pop(); }],
  ['v1.1 lane length differs from stepCount', 'song-mode.json', (s) => { s.globals.stepCount = 8; }],
  ['v1.1 song row naming an undefined pattern', 'song-mode.json', (s) => { s.song[0].kick = 'nowhere'; }],
  ['note step past the end of the pattern', 'minimal.json', (s) => { s.tracks.synthA.notes[0].step = 32; }],
  ['pattern-local lane shadowed by a song-wide lane', 'song-mode.json', (s) => {
    const lane = Object.values<Json>(s.patterns).find((p) => p.automation?.length)?.automation[0];
    if (!lane) throw new Error('song-mode.json fixture lost its pattern-local lane');
    s.automation = [clone(lane)];
  }],
];

describe('rules only the importer can enforce (the schema documents them as a gap)', () => {
  it.each(IMPORTER_ONLY)('%s', (_name, base, mutate) => {
    const song = clone(load(base));
    mutate(song);
    expect(bySchema(song), JSON.stringify(validateSchema.errors)).toBe(true);
    expect(byCode(song)).toBe(false);
  });
});

/** The importer ignores unknown keys; the schema rejects them so agents see typos. */
const SCHEMA_ONLY: Mutation[] = [
  ['unknown top-level key', 'minimal.json', (s) => { s.description = 'hi'; }],
  ['misspelled synth param', 'minimal.json', (s) => { s.tracks.synthA.params.filtercutoff = 900; }],
  ['unknown track', 'minimal.json', (s) => { s.tracks.synthC = { notes: [] }; }],
];

describe('keys the importer ignores but the schema rejects', () => {
  it.each(SCHEMA_ONLY)('%s', (_name, base, mutate) => {
    const song = clone(load(base));
    mutate(song);
    expect(bySchema(song)).toBe(false);
    expect(validateAISongData(song).valid).toBe(true);
  });
});
