/**
 * Golden test for the AI song ingest path.
 *
 * The contract this file pins down: an agent handed `docs/ai-song-format.md`
 * can return a JSON file that validates, imports, and produces a playable
 * `SavedSongData` — notes on the right steps, globals applied, and automation
 * lanes that reach `automationStore` obeying the [0, 1] point invariant.
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  AISongImporter,
  parseAISongJSON,
  type AISongData,
} from '../importers/ai-song';
import { validateAISongData } from '../importers/ai-song/types';
import { validateBeforeUpload } from '../services/ai-song-storage/validation';
import { automationStore } from '../stores/automationStore';
import { AutomationScheduler } from '../audio/automation/AutomationScheduler';
import type { Open303Manager } from '../engines/Open303Manager';
import type { Note, PartSequence, SavedSongData, UnifiedAutomationLane } from '../types';

const FIXTURE_DIR = resolve(process.cwd(), 'test-fixtures/ai-song');

function loadFixture(name: string): AISongData {
  const raw = readFileSync(resolve(FIXTURE_DIR, `${name}.json`), 'utf-8');
  const parsed = parseAISongJSON(raw);
  expect(parsed.success).toBe(true);
  if (!parsed.success) throw new Error(parsed.error);
  return parsed.data;
}

function importFixture(name: string): SavedSongData {
  const result = new AISongImporter().convert(loadFixture(name));
  if (!result.success) {
    throw new Error(`import failed: ${JSON.stringify(result.error)}`);
  }
  return result.song;
}

function noteAt(sequence: PartSequence, step: number): Note {
  const note = sequence.steps[step];
  expect(note, `expected a note at step ${step}`).not.toBeNull();
  return note as Note;
}

function filledSteps(sequence: PartSequence): number[] {
  return sequence.steps.flatMap((note, step) => (note ? [step] : []));
}

beforeEach(() => {
  automationStore.reset();
});

describe.each(['minimal', 'full'])('AI song fixture: %s', (name) => {
  it('validates against the published schema', () => {
    expect(validateAISongData(loadFixture(name))).toEqual({ valid: true });
  });

  it('imports without warnings and passes the pre-upload check', () => {
    const aiSong = loadFixture(name);
    const result = new AISongImporter().convert(aiSong);

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.report.warnings).toEqual([]);
    expect(validateBeforeUpload(aiSong, result.song)).toBeNull();
  });

  it('produces a 32-step pattern for every track', () => {
    const song = importFixture(name);
    for (const key of ['partA', 'partB', 'bass2', 'kick', 'snare', 'closedHat', 'openHat'] as const) {
      expect(song.pattern[key].steps, key).toHaveLength(32);
    }
    expect(song.pattern.sampler).toHaveLength(8);
    for (const bank of song.pattern.sampler) {
      expect(bank.steps).toHaveLength(32);
    }
  });
});

describe('AI song ingest — minimal fixture', () => {
  it('places the 303 line and the kick on the authored steps', () => {
    const song = importFixture('minimal');

    expect(filledSteps(song.pattern.partA)).toEqual([0, 3, 6, 8, 11, 14]);
    expect(noteAt(song.pattern.partA, 0).note).toBe('C2');
    expect(noteAt(song.pattern.partA, 0).velocity).toBeCloseTo(0.9);
    expect(noteAt(song.pattern.partA, 6).slide).toBe(true);

    // A 16-step drum track is doubled to fill Hyphon's 32-step pattern.
    expect(filledSteps(song.pattern.kick)).toEqual([0, 4, 8, 12, 16, 20, 24, 28]);
  });

  it('applies tempo and defaults the optional globals', () => {
    const song = importFixture('minimal');

    expect(song.tempo).toBe(128);
    expect(song.timeSignature).toEqual([4, 4]);
    expect(song.swing).toBe(50);
  });

  it('carries the authored synth params through', () => {
    const song = importFixture('minimal');

    expect(song.params.synthA.waveform).toBe('303-saw');
    expect(song.params.synthA.filterCutoff).toBe(1200);
    expect(song.params.synthA.filterResonance).toBe(16);
  });

  it('emits no automation lanes when the song declares none', () => {
    expect(importFixture('minimal').automationLanes).toBeUndefined();
  });
});

describe('AI song ingest — full fixture', () => {
  it('applies the non-default time signature and swing', () => {
    const song = importFixture('full');

    expect(song.tempo).toBe(96);
    expect(song.timeSignature).toEqual([3, 4]);
    expect(song.swing).toBe(62);
  });

  it('converts every melodic, drum and sampler track', () => {
    const song = importFixture('full');

    expect(filledSteps(song.pattern.partA)).toEqual([0, 4, 6, 12, 16, 24, 28]);
    expect(filledSteps(song.pattern.partB)).toEqual([2, 10, 14, 22, 26]);
    expect(filledSteps(song.pattern.bass2)).toEqual([0, 12, 18, 24]);
    expect(filledSteps(song.pattern.kick)).toEqual([0, 6, 12, 18, 24, 30]);
    expect(filledSteps(song.pattern.snare)).toEqual([6, 18, 30]);
    expect(filledSteps(song.pattern.openHat)).toEqual([11, 23]);
    expect(filledSteps(song.pattern.closedHat)).toHaveLength(16);

    // Sampler banks land on their own bank index, not in authoring order.
    expect(filledSteps(song.pattern.sampler[0])).toEqual([0, 12, 24]);
    expect(filledSteps(song.pattern.sampler[3])).toEqual([6, 30]);
    expect(filledSteps(song.pattern.sampler[1])).toEqual([]);

    expect(noteAt(song.pattern.partA, 28).length).toBe(2);
    expect(noteAt(song.pattern.partA, 0).timbre).toBe(1.0); // accent
  });

  it('maps bass2 into the dedicated Bass2Params shape', () => {
    const song = importFixture('full');

    expect(song.params.bass2).toBeDefined();
    expect(song.params.bass2?.waveform).toBe('303-sqr');
    expect(song.params.bass2?.cutoff).toBe(900);
    expect(song.params.bass2?.resonance).toBe(20);
  });

  it('applies sampler bank params without inventing a steps field', () => {
    const song = importFixture('full');

    expect(song.params.sampler[0].sampleName).toBe('three four');
    expect(song.params.sampler[0].filterCutoff).toBe(12000);
    expect(song.params.sampler[3].playbackSpeed).toBe(1.25);
    expect(song.params.sampler[3].sampleName).toBe('sample://fixture/clap');
    expect(song.params.sampler[0]).not.toHaveProperty('steps');
  });

  it('emits one automation lane per authored lane, tagged as AI-sourced', () => {
    const song = importFixture('full');
    const lanes = song.automationLanes;

    expect(lanes).toBeDefined();
    expect(lanes).toHaveLength(3);

    expect(lanes?.map((lane) => `${lane.target}.${lane.parameter}`)).toEqual([
      'synthA.filterCutoff',
      'synthB.filterResonance',
      'bass2.decay',
    ]);

    for (const lane of lanes ?? []) {
      expect(lane.source).toBe('ai');
      expect(lane.enabled).toBe(true);
      expect(lane.scope).toBe('song');
      expect(lane.id).toBeTruthy();
      expect(lane.originalRange).toEqual([0, 127]);
    }

    expect(lanes?.[0].interpolation).toBe('linear');
    expect(lanes?.[1].interpolation).toBe('smooth');
    expect(lanes?.[2].interpolation).toBe('step');
  });

  it('normalizes every automation point into [0, 1] — the session-5 invariant', () => {
    const lanes = importFixture('full').automationLanes ?? [];
    expect(lanes.length).toBeGreaterThan(0);

    for (const lane of lanes) {
      expect(lane.points.length).toBeGreaterThan(0);
      for (const point of lane.points) {
        expect(point.value).toBeGreaterThanOrEqual(0);
        expect(point.value).toBeLessThanOrEqual(1);
        expect(Number.isFinite(point.step)).toBe(true);
      }
    }

    // MIDI 127 is full scale; a lane with holes only emits its non-null steps.
    const cutoff = lanes[0];
    expect(Math.max(...cutoff.points.map((p) => p.value))).toBe(1);
    expect(cutoff.points).toHaveLength(32);

    const resonance = lanes[1];
    expect(resonance.points).toHaveLength(8);
    expect(resonance.points.map((p) => p.step)).toEqual([0, 4, 8, 12, 16, 20, 24, 28]);
    expect(resonance.points[0].value).toBeCloseTo(20 / 127, 5);
  });

  it('hands its lanes to automationStore.importLanes intact', () => {
    const song = importFixture('full');

    automationStore.importLanes(song.automationLanes ?? []);

    const stored = automationStore.getState().lanes;
    expect(stored).toHaveLength(3);
    expect(stored.map((lane) => lane.parameter)).toEqual([
      'filterCutoff',
      'filterResonance',
      'decay',
    ]);
    expect(stored.every((lane) => lane.source === 'ai')).toBe(true);
    expect(
      stored.every((lane) => lane.points.every((p) => p.value >= 0 && p.value <= 1)),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The payoff: lanes imported from an AI song drive the scheduler, and the
// values it applies actually move over the pattern.
// ---------------------------------------------------------------------------

/** Minimal Open303Manager double — records every scheduled parameter write. */
function makeOpen303Manager() {
  return {
    isBass1Ready: vi.fn(() => true),
    isBass2Ready: vi.fn(() => true),
    isLead303Ready: vi.fn(() => true),
    scheduleParamAtTime: vi.fn(),
    scheduleParamRamp: vi.fn(),
    scheduleSlideAtTime: vi.fn(),
  };
}

type ScheduledCall = [voice: string, setter: string, value: number, time: number];

/**
 * Run the imported lanes through the scheduler for a whole 32-step pattern and
 * return the values applied to one voice/setter pair, in scheduling order.
 */
function applyLanesToScheduler(
  lanes: UnifiedAutomationLane[],
  voice: string,
  setter: string,
): number[] {
  const mgr = makeOpen303Manager();
  const ctx = { currentTime: 0 } as unknown as AudioContext;
  const scheduler = new AutomationScheduler(ctx, mgr as unknown as Open303Manager);

  const stepTime = 0.125;
  automationStore.importLanes(lanes);
  scheduler.scheduleFromLanes(automationStore.getState().lanes, 0, 32, stepTime, 0);
  vi.runAllTimers();

  return (mgr.scheduleParamAtTime.mock.calls as ScheduledCall[])
    .filter(([v, s]) => v === voice && s === setter)
    .map(([, , value]) => value);
}

describe('AI song automation reaches the scheduler with varying applied values', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('drives the synthA cutoff sweep across the whole pattern', () => {
    const song = importFixture('full');
    const applied = applyLanesToScheduler(song.automationLanes ?? [], 'lead303', 'setCutoff');

    // One applied value per step of the dense lane.
    expect(applied).toHaveLength(32);

    // VARYING: the sweep must actually move, not sit on one value.
    expect(new Set(applied).size).toBeGreaterThan(8);
    expect(Math.min(...applied)).toBeLessThan(0.25);
    expect(Math.max(...applied)).toBe(1);

    // Every applied value stays normalized — `originalRange: [0, 127]` is
    // display metadata, so denormalizing here would pin the lane at 1.0.
    for (const value of applied) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
    expect(applied.every((v) => v === 1)).toBe(false);

    // The authored shape survives: rises to the peak, then falls back.
    const peak = applied.indexOf(1);
    expect(peak).toBeGreaterThan(0);
    expect(peak).toBeLessThan(31);
    expect(applied[0]).toBeLessThan(applied[peak]);
    expect(applied[31]).toBeLessThan(applied[peak]);
  });

  it('interpolates a sparse lane into a value on every step (smooth)', () => {
    const song = importFixture('full');
    const applied = applyLanesToScheduler(song.automationLanes ?? [], 'bass1', 'setResonance');

    // The lane holds only 8 authored points but is sampled on all 32 steps.
    expect(applied).toHaveLength(32);
    expect(new Set(applied).size).toBeGreaterThan(8);

    // Authored points are hit exactly; the holes between them are filled.
    expect(applied[0]).toBeCloseTo(20 / 127, 5);
    expect(applied[1]).toBeGreaterThan(applied[0]);
    expect(applied[1]).toBeLessThan(applied[4]);
    expect(applied.every((v) => v >= 0 && v <= 1)).toBe(true);
  });

  it('holds each plateau of a stepped lane, then jumps (step)', () => {
    const song = importFixture('full');
    const applied = applyLanesToScheduler(song.automationLanes ?? [], 'bass2', 'setDecay');

    expect(applied).toHaveLength(32);

    // Four authored plateaus: constant within each, different between them.
    const plateaus = [0, 8, 16, 24].map((start) => applied.slice(start, start + 8));
    for (const plateau of plateaus) {
      expect(new Set(plateau).size).toBe(1);
    }
    const levels = plateaus.map((p) => p[0]);
    expect(new Set(levels).size).toBe(4);
    expect(levels).toEqual([30 / 127, 70 / 127, 100 / 127, 55 / 127]);
  });

  it('applies nothing when the lanes are disabled', () => {
    const song = importFixture('full');
    const disabled = (song.automationLanes ?? []).map((lane) => ({ ...lane, enabled: false }));

    expect(applyLanesToScheduler(disabled, 'lead303', 'setCutoff')).toEqual([]);
  });

  it('pins the known dispatch gap: valid targets the scheduler does not route', () => {
    // The schema accepts drum/sampler automation targets, but the scheduler
    // only routes synthA/synthB/bass2 (plus three PCF params on master).
    // Documented under "Silently ignored" in docs/ai-song-format.md.
    const song = importFixture('full');
    const lane: UnifiedAutomationLane = {
      ...(song.automationLanes ?? [])[0],
      target: 'kick',
      parameter: 'decay',
    };

    const mgr = makeOpen303Manager();
    const ctx = { currentTime: 0 } as unknown as AudioContext;
    const scheduler = new AutomationScheduler(ctx, mgr as unknown as Open303Manager);

    automationStore.importLanes([lane]);
    scheduler.scheduleFromLanes(automationStore.getState().lanes, 0, 32, 0.125, 0);
    vi.runAllTimers();

    expect(mgr.scheduleParamAtTime).not.toHaveBeenCalled();
  });
});

describe('AI song ingest — schema gaps surface at import, not at upload', () => {
  const requiredMeta = ['author', 'generator', 'prompt'] as const;

  it.each(requiredMeta)('rejects a song missing meta.%s', (field) => {
    const aiSong = loadFixture('minimal');
    delete (aiSong.meta as Record<string, unknown>)[field];

    const result = new AISongImporter().convert(aiSong);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toEqual({
      type: 'VALIDATION_ERROR',
      field: `meta.${field}`,
      message: `${field} string required`,
    });
  });

  it('rejects a malformed time signature', () => {
    const aiSong = loadFixture('full');
    (aiSong.globals as Record<string, unknown>).timeSignature = [0, 4];

    const result = new AISongImporter().convert(aiSong);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toMatchObject({ field: 'globals.timeSignature' });
  });

  it('rejects out-of-range swing', () => {
    const aiSong = loadFixture('full');
    (aiSong.globals as Record<string, unknown>).swing = 140;

    const result = new AISongImporter().convert(aiSong);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toMatchObject({ field: 'globals.swing' });
  });
});

describe('validateBeforeUpload reads the real SavedSongData fields', () => {
  it('rejects a song with no notes', () => {
    const aiSong = loadFixture('minimal');
    const song = importFixture('minimal');
    const empty: SavedSongData = {
      ...song,
      pattern: {
        ...song.pattern,
        partA: { steps: Array(32).fill(null) },
        kick: { steps: Array(32).fill(null) },
      },
    };

    expect(validateBeforeUpload(aiSong, empty)).toMatchObject({
      category: 'VALIDATION',
      field: 'pattern',
    });
  });

  it('rejects an out-of-range tempo', () => {
    const aiSong = loadFixture('minimal');
    const song = importFixture('minimal');

    expect(validateBeforeUpload(aiSong, { ...song, tempo: 0 })).toMatchObject({
      field: 'tempo',
    });
  });
});
