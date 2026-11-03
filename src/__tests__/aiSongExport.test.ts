/**
 * `exportAISong` is the inverse of the AI song importer.
 *
 * The contract the co-producer relies on: for every song `x` the strict
 * importer takes, `import(export(import(x)))` is the song `import(x)` (modulo
 * the lane ids the importer mints and the normalisations listed in `played`),
 * and exporting is a fixed point — `export(import(export(import(x))))` is the
 * same JSON as `export(import(x))`. Every fixture and a fast-check generator of
 * strict-valid v1.0 / v1.1 songs are held to it, and every exported song must
 * pass the published JSON Schema and the strict importer with no warnings.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { AISongImporter, type AISongData } from '../importers/ai-song';
import { exportAISong, patternIdSlot, slotPatternId } from '../importers/ai-song/exportAISong';
import { VALID_PARAMETERS_BY_TARGET } from '../importers/ai-song/automationParameters';
import { laneDispatchGap } from '../audio/automation/laneResolver';
import type {
  AIAutomationLane, AINoteEvent, AIPatternData, AISamplerBankData, AISongRow, AISongTrackName, AISongTracks,
} from '../importers/ai-song/types';
import type { Note, SavedSongData, UnifiedAutomationLane } from '../types';
import {
  DEFAULT_BASS2_PARAMS, DEFAULT_CLOSED_HAT_PARAMS, DEFAULT_KICK_PARAMS, DEFAULT_OPEN_HAT_PARAMS,
  DEFAULT_SAMPLER_PARAMS, DEFAULT_SNARE_PARAMS, DEFAULT_SYNTH_PARAMS_A, DEFAULT_SYNTH_PARAMS_B,
} from '../constants';
import { UPDATED_INITIAL_PATTERN, getInitialTrackStorage } from '../constants/appDefaults';

const createInitialTrackStorage = () => getInitialTrackStorage(UPDATED_INITIAL_PATTERN);

const ROOT = process.cwd();
const FIXTURE_DIR = resolve(ROOT, 'test-fixtures/ai-song');
const ajv = new Ajv2020({ allErrors: false, strict: true });
addFormats(ajv);
const validateSchema = ajv.compile(JSON.parse(readFileSync(resolve(ROOT, 'docs/schemas/ai-song.schema.json'), 'utf8')) as object);

const META = {
  title: 'Round trip',
  author: 'tests',
  version: '1.1' as const,
  createdAt: '2026-11-02T00:00:00Z',
  generator: 'fast-check',
  prompt: 'Any song the strict importer takes.',
};

function importStrict(song: AISongData): SavedSongData {
  const result = new AISongImporter().convert(song, { strict: true });
  if (!result.success) throw new Error(`strict import failed: ${JSON.stringify(result.error)}`);
  return result.song;
}

const exportOf = (song: SavedSongData) => exportAISong(song, { meta: { ...META } });

/**
 * The song as it plays: lane ids minted per import dropped, `slide: false`
 * read as no slide (the export writes `slide` only when set), per-slot 303
 * knobs resolved (no snapshot = the song knobs, which is what slot recall
 * does), and lanes grouped by `target.parameter` — the importer orders
 * pattern-local lanes by the pattern they come from, and only the order of
 * lanes on the same parameter can change what plays (the first with a value
 * wins), which the stable sort keeps.
 */
function played(song: SavedSongData): unknown {
  const clean = JSON.parse(JSON.stringify(song)) as SavedSongData;
  const notes = (steps: (Note | null)[]) => steps.forEach((n) => { if (n && n.slide === false) delete n.slide; });
  const walk = (seq: unknown) => {
    if (Array.isArray(seq)) seq.forEach(walk);
    else if (seq && typeof seq === 'object' && Array.isArray((seq as { steps?: unknown }).steps)) notes((seq as { steps: (Note | null)[] }).steps);
  };
  walk(Object.values(clean.pattern));
  Object.values(clean.trackStorage).forEach(walk);
  const laneKey = (l: UnifiedAutomationLane) => `${l.timeline ?? ''}|${l.target}.${l.parameter}`;
  clean.automationLanes = clean.automationLanes?.map((lane) => ({ ...lane, id: '' }))
    .sort((a, b) => laneKey(a).localeCompare(laneKey(b)));
  const effective = Object.fromEntries((['synthA', 'synthB', 'bass2'] as const).map((track) => [
    track,
    Array.from({ length: 32 }, (_, slot) => ({ ...clean.params[track], ...(clean.trackParamStorage?.[track]?.[slot] ?? {}) })),
  ]));
  delete clean.trackParamStorage;
  return { ...clean, effective };
}

function expectRoundTrip(x: AISongData): void {
  const s1 = importStrict(x);
  const e1 = exportOf(s1);
  expect(validateSchema(e1.song), JSON.stringify(validateSchema.errors)).toBe(true);
  expect(e1.losses).toEqual([]);
  const s2 = importStrict(e1.song);
  expect(played(s2)).toEqual(played(s1));
  expect(exportOf(s2).song).toEqual(e1.song);
}

const fixtures = readdirSync(FIXTURE_DIR).filter((f) => f.endsWith('.json'));
const loadFixture = (file: string) => JSON.parse(readFileSync(resolve(FIXTURE_DIR, file), 'utf8')) as AISongData;

describe('exportAISong(importAISong(x)) round-trips every fixture', () => {
  it('finds the fixtures', () => {
    expect(fixtures).toEqual(expect.arrayContaining(['minimal.json', 'full.json', 'song-mode.json']));
  });

  it.each(fixtures)('%s', (file) => expectRoundTrip(loadFixture(file)));

  it('keeps the format version and leaves out what the importer defaults', () => {
    const minimal = exportOf(importStrict(loadFixture('minimal.json'))).song;
    expect(minimal.meta.version).toBe('1.0');
    expect(minimal.globals).toEqual({ tempo: 128 });
    expect(minimal.tracks?.synthA?.notes[1]).toEqual({ step: 3, note: 'C2' });
    expect(minimal.tracks?.synthA?.notes[0]).toEqual({ step: 0, note: 'C2', velocity: 0.9, accent: true });
    expect(Object.keys(minimal.tracks ?? {}).sort()).toEqual(['kick', 'synthA']);

    const songMode = exportOf(importStrict(loadFixture('song-mode.json'))).song;
    expect(songMode.meta.version).toBe('1.1');
    expect(songMode.globals.stepCount).toBe(16);
    // Each track plays at most three of the four patterns, so three slots.
    expect(Object.keys(songMode.patterns ?? {})).toEqual(['slot0', 'slot1', 'slot2']);
    expect(songMode.song?.[0]).toEqual({ kick: 'slot0', closedHat: 'slot0' });
    // The drop's filter sweep is a pattern-local lane again.
    const lanes = Object.values(songMode.patterns ?? {}).flatMap((p) => p.automation ?? []);
    expect(lanes.map((l) => `${l.target}.${l.parameter}`)).toEqual(['synthA.filterCutoff']);
  });

  it('keeps a pattern lane whose between-measure hold points land on step 0 (a one-step pattern)', () => {
    // fast-check found this: with stepCount 1 the tiler's hold point after an
    // occurrence sits on the next measure's first step, like an occurrence.
    expectRoundTrip({
      meta: META,
      globals: { tempo: 30, stepCount: 1 },
      patterns: {
        B: { tracks: { synthA: { notes: [] } } },
        intro: {
          tracks: { synthA: { notes: [] } },
          automation: [{ target: 'synthA', parameter: 'filterCutoff', steps: [0], interpolation: 'step' }],
        },
      },
      song: [{ synthA: 'intro' }, { synthA: 'B' }, { synthA: 'intro' }, { synthA: 'B' }],
    });
  });

  it('names patterns after their slot', () => {
    expect(slotPatternId(3)).toBe('slot3');
    expect(patternIdSlot('slot12')).toBe(12);
    expect(patternIdSlot('drop')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// fast-check: strict-valid songs
// ---------------------------------------------------------------------------

const NOTE_NAMES = fc.tuple(
  fc.constantFrom('A', 'B', 'C', 'D', 'E', 'F', 'G'),
  fc.constantFrom('', '#', 'b'),
  fc.integer({ min: 0, max: 8 }),
).map(([n, acc, oct]) => `${n}${acc}${oct}`);

const unit = fc.double({ min: 0, max: 1, noNaN: true });

function noteEvent(steps: number, melodic: boolean): fc.Arbitrary<AINoteEvent> {
  return fc.record({
    step: fc.integer({ min: 0, max: steps - 1 }),
    note: NOTE_NAMES,
    velocity: unit,
    length: fc.oneof(fc.integer({ min: 1, max: 8 }), fc.double({ min: 1, max: 8, noNaN: true })),
    ...(melodic ? { accent: fc.boolean(), slide: fc.boolean() } : {}),
  }, { requiredKeys: ['step', 'note'] }) as fc.Arbitrary<AINoteEvent>;
}

const synthParams = fc.record({
  waveform: fc.constantFrom('303-saw', '303-sqr', 'sawtooth', 'square', 'triangle', 'sine', 'macro-va', 'prophecy-saw'),
  pitch: fc.integer({ min: -24, max: 24 }),
  filterCutoff: fc.double({ min: 20, max: 8000, noNaN: true }),
  filterResonance: fc.double({ min: 0, max: 20, noNaN: true }),
  decay: fc.double({ min: 0.01, max: 2, noNaN: true }),
  volume: unit,
  delayMix: unit,
}, { requiredKeys: [] });

const melodicTrack = (steps: number) => fc.record({
  notes: fc.array(noteEvent(steps, true), { maxLength: 6 }),
  params: synthParams,
}, { requiredKeys: ['notes'] });

const drumTrack = (steps: number, v10: boolean) =>
  fc.integer({ min: 0, max: steps }).chain((len) => fc.array(fc.boolean(), {
    minLength: v10 && len > 0 ? (len <= 16 ? 16 : 32) : len,
    maxLength: v10 && len > 0 ? (len <= 16 ? 16 : 32) : len,
  }));

const samplerBanks = (steps: number) => fc.uniqueArray(
  fc.record({
    bankIndex: fc.integer({ min: 0, max: 7 }),
    steps: fc.array(noteEvent(steps, false), { maxLength: 4 }),
    params: fc.record({
      playbackSpeed: fc.double({ min: 0.25, max: 4, noNaN: true }),
      volume: unit,
      filterCutoff: fc.double({ min: 20, max: 20000, noNaN: true }),
    }, { requiredKeys: [] }),
    ttsText: fc.constantFrom('three four', 'hey', 'la la la'),
    sampleUrl: fc.constantFrom('sample://fixture/clap', 'https://samples.test/hat.wav'),
  }, { requiredKeys: ['bankIndex', 'steps'] }),
  { selector: (b) => b.bankIndex, maxLength: 3 },
) as fc.Arbitrary<AISamplerBankData[]>;

const tracksOf = (steps: number, v10: boolean) => fc.record({
  synthA: melodicTrack(steps),
  synthB: melodicTrack(steps),
  bass2: melodicTrack(steps),
  kick: drumTrack(steps, v10),
  snare: drumTrack(steps, v10),
  closedHat: drumTrack(steps, v10),
  openHat: drumTrack(steps, v10),
  sampler: samplerBanks(steps),
}, { requiredKeys: [] }) as fc.Arbitrary<AISongTracks>;

/** Lane keys the live scheduler plays — strict import rejects the rest. */
const PLAYED_LANES = (['synthA', 'synthB', 'bass2'] as const).flatMap((target) =>
  VALID_PARAMETERS_BY_TARGET[target]
    .filter((parameter) => laneDispatchGap(target, parameter) === null)
    .map((parameter) => ({ target, parameter })));

const lane = (steps: number) => fc.record({
  key: fc.constantFrom(...PLAYED_LANES),
  steps: fc.array(fc.option(fc.integer({ min: 0, max: 127 }), { nil: null, freq: 2 }), { minLength: steps, maxLength: steps }),
  interpolation: fc.constantFrom('step', 'linear', 'smooth'),
}).map(({ key, ...rest }) => ({ ...key, ...rest }) as AIAutomationLane);

const globalsOf = (stepCount?: number) => fc.record({
  tempo: fc.double({ min: 30, max: 300, noNaN: true }),
  timeSignature: fc.tuple(fc.integer({ min: 1, max: 32 }), fc.integer({ min: 1, max: 32 })),
  swing: fc.double({ min: 0, max: 100, noNaN: true }),
}, { requiredKeys: ['tempo'] }).map((g) => (stepCount === undefined ? g : { ...g, stepCount }));

/** Length the v1.0 validator wants lanes to have (the first drum track decides). */
function v10LaneLength(tracks: AISongTracks): number {
  for (const drum of [tracks.kick, tracks.snare, tracks.closedHat, tracks.openHat]) {
    if (drum && drum.length > 0) return drum.length <= 16 ? 16 : 32;
  }
  return 32;
}

const v10Song: fc.Arbitrary<AISongData> = tracksOf(32, true).chain((tracks) => fc.record({
  globals: globalsOf(),
  automation: fc.array(lane(v10LaneLength(tracks)), { maxLength: 3 }),
}).map(({ globals, automation }) => ({
  meta: { ...META, version: '1.0' as const },
  globals,
  tracks,
  ...(automation.length ? { automation } : {}),
})));

const PATTERN_IDS = ['A', 'B', 'intro', 'drop'];

const v11Song: fc.Arbitrary<AISongData> = fc.integer({ min: 1, max: 64 }).chain((steps) => fc.record({
  globals: globalsOf(steps),
  patterns: fc.uniqueArray(fc.constantFrom(...PATTERN_IDS), { minLength: 1, maxLength: 4 }).chain((ids) =>
    fc.tuple(...ids.map(() => fc.record({ tracks: tracksOf(steps, false), automation: fc.array(lane(steps), { maxLength: 2 }) })))
      .map((list) => Object.fromEntries(ids.map((id, i) => [id, list[i]])) as Record<string, AIPatternData>)),
  rowSeed: fc.array(fc.array(fc.integer({ min: 0, max: 5 }), { minLength: 8, maxLength: 8 }), { minLength: 1, maxLength: 6 }),
  songWide: fc.array(lane(steps), { maxLength: 2 }),
  tracksForm: fc.boolean(),
})).map(({ globals, patterns, rowSeed, songWide, tracksForm }) => buildV11(globals, patterns, rowSeed, songWide, tracksForm));

/**
 * Make a generated block strict-valid: rows only name patterns that have the
 * track, unused patterns go, pattern lanes only on a track that plays them and
 * never on a song-wide key, one interpolation per key.
 */
function buildV11(
  globals: AISongData['globals'],
  patterns: Record<string, AIPatternData>,
  rowSeed: number[][],
  songWide: AIAutomationLane[],
  tracksForm: boolean,
): AISongData {
  const meta = { ...META, version: '1.1' as const };
  if (tracksForm) {
    const first = Object.values(patterns)[0];
    return { meta, globals, tracks: first.tracks, ...(songWide.length ? { automation: songWide } : {}) };
  }
  const names: AISongTrackName[] = ['synthA', 'synthB', 'bass2', 'kick', 'snare', 'closedHat', 'openHat', 'sampler'];
  const ids = Object.keys(patterns);
  const song: AISongRow[] = rowSeed.map((seed) => {
    const row: AISongRow = {};
    names.forEach((track, t) => {
      const having = ids.filter((id) => patterns[id].tracks[track] !== undefined);
      const pick = seed[t];
      if (having.length > 0 && pick < having.length) row[track] = having[pick];
    });
    return row;
  });
  const used = new Set(song.flatMap((row) => Object.values(row)));
  const songWideKeys = new Set(songWide.map((l) => `${l.target}.${l.parameter}`));
  const modes = new Map<string, AIAutomationLane['interpolation']>();
  const kept: Record<string, AIPatternData> = {};
  for (const id of ids) {
    if (!used.has(id)) continue;
    const lanes = (patterns[id].automation ?? []).filter((l) =>
      !songWideKeys.has(`${l.target}.${l.parameter}`) && song.some((row) => row[l.target as AISongTrackName] === id))
      .map((l) => {
        const key = `${l.target}.${l.parameter}`;
        if (!modes.has(key)) modes.set(key, l.interpolation);
        return { ...l, interpolation: modes.get(key) };
      });
    kept[id] = { tracks: patterns[id].tracks, ...(lanes.length ? { automation: lanes } : {}) };
  }
  if (Object.keys(kept).length === 0) {
    return { meta, globals, tracks: patterns[ids[0]].tracks, ...(songWide.length ? { automation: songWide } : {}) };
  }
  return { meta, globals, patterns: kept, song, ...(songWide.length ? { automation: songWide } : {}) };
}

const strictOk = (x: AISongData) => new AISongImporter().convert(x, { strict: true }).success;

describe('exportAISong round-trips generated songs', () => {
  it('v1.0: one 32-step pattern', () => {
    fc.assert(fc.property(v10Song, (x) => {
      fc.pre(strictOk(x));
      expectRoundTrip(x);
    }), { numRuns: 150 });
  });

  it('v1.1: patterns, rows and pattern-local lanes', () => {
    fc.assert(fc.property(v11Song, (x) => {
      fc.pre(strictOk(x));
      expectRoundTrip(x);
    }), { numRuns: 300 });
  });
});

// ---------------------------------------------------------------------------
// Songs made in the app, not by the importer
// ---------------------------------------------------------------------------

/** A song as the save path writes one before anyone edits it. */
function appSong(overrides: Partial<SavedSongData> = {}): SavedSongData {
  return {
    version: 5,
    pattern: structuredClone(UPDATED_INITIAL_PATTERN),
    params: {
      synthA: { ...DEFAULT_SYNTH_PARAMS_A },
      synthB: { ...DEFAULT_SYNTH_PARAMS_B },
      bass2: { ...DEFAULT_BASS2_PARAMS },
      kick: { ...DEFAULT_KICK_PARAMS },
      snare: { ...DEFAULT_SNARE_PARAMS },
      closedHat: { ...DEFAULT_CLOSED_HAT_PARAMS },
      openHat: { ...DEFAULT_OPEN_HAT_PARAMS },
      sampler: structuredClone(DEFAULT_SAMPLER_PARAMS),
    },
    trackStorage: createInitialTrackStorage() as unknown as Record<string, unknown>,
    activeTrackSlots: { partA: 0, partB: 0, bass2: 0, kick: 0, snare: 0, closedHat: 0, openHat: 0, sampler: 0 },
    songStructure: [],
    arrangement: { clips: [], lengthSteps: 32 },
    tempo: 120,
    stepCount: 32,
    timeSignature: [4, 4],
    swing: 50,
    ...overrides,
  };
}

describe('exporting a song made in the app', () => {
  it('writes a schema-valid song the strict importer takes', () => {
    const { song } = exportOf(appSong());
    expect(validateSchema(song), JSON.stringify(validateSchema.errors)).toBe(true);
    expect(strictOk(song)).toBe(true);
  });

  it('reports what the AI format cannot carry instead of dropping it silently', () => {
    const base = appSong();
    const partA = [...base.pattern.partA.steps];
    partA[0] = { note: 'C3', velocity: 1, length: 1, chord: ['E3', 'G3'], microtiming: 0.2 };
    const kick = [...base.pattern.kick.steps];
    kick[4] = { note: 'C2', velocity: 0.5, length: 1 };
    const lanes: UnifiedAutomationLane[] = [{
      id: 'l1', target: 'kick', parameter: 'decay', name: 'kick decay', points: [{ step: 0, value: 0.5 }],
      interpolation: 'step', source: 'manual', scope: 'song', enabled: true,
    }];
    const { song, losses } = exportOf(appSong({
      pattern: { ...base.pattern, partA: { steps: partA }, kick: { steps: kick } },
      automationLanes: lanes,
      noteFx: { partA: { enabled: true, modules: [] } } as unknown as SavedSongData['noteFx'],
    }));
    const text = losses.map((l) => `${l.where}: ${l.message}`).join('\n');
    expect(text).toMatch(/partA pattern: note fields the AI format has no place for: chord \(1\), microtiming \(1\)/);
    expect(text).toMatch(/kick pattern: 1 drum hit with a velocity other than 1/);
    expect(text).toMatch(/automationLanes\[0\] kick\.decay: kick\.decay never plays/);
    expect(text).toMatch(/noteFx: note FX chains/);
    expect(song.automation).toBeUndefined();
    expect(song.tracks?.synthA?.notes[0]).toEqual({ step: 0, note: 'C3', velocity: 1 });
    expect(validateSchema(song), JSON.stringify(validateSchema.errors)).toBe(true);
  });

  it('exports trimmed clips as the measure they cover, and says so', () => {
    const { song, losses } = exportOf(appSong({
      arrangement: {
        lengthSteps: 64,
        clips: [
          { id: 'clip-1', track: 'kick', patternSlot: 0, startStep: 0, lengthSteps: 64, loop: true },
          { id: 'clip-2', track: 'partA', patternSlot: 1, startStep: 32, lengthSteps: 20, loop: false },
        ],
      },
    }));
    expect(song.song).toEqual([{ kick: 'slot0' }, { synthA: 'slot1', kick: 'slot0' }]);
    expect(losses.map((l) => l.where)).toContain('arrangement partA clip clip-2');
    expect(losses.map((l) => l.where)).not.toContain('arrangement kick clip clip-1');
  });

  it('reports pattern slots the arrangement never plays', () => {
    const storage = createInitialTrackStorage();
    storage.partB[5] = { steps: [{ note: 'C3', velocity: 1, length: 1 }] };
    const { losses } = exportOf(appSong({ trackStorage: storage as unknown as Record<string, unknown> }));
    expect(losses).toContainEqual(expect.objectContaining({ where: 'partB slot 5' }));
  });
});
