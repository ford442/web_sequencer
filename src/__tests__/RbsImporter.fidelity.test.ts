/**
 * Importer mapping fidelity: slides, ties, accents, PCF, drums, empty patterns.
 */
import { describe, expect, it } from 'vitest';
import type { Note } from '../types';
import { RbsImporter } from '../importers/rbs/RbsImporter';
import type { RawRbsData, Tb303Step } from '../importers/rbs/types';
import { buildLegacyRbsFile } from './rbs/fixtures';
import { RbsParser } from '../importers/rbs/RbsParser';

function makeRaw(overrides: Partial<RawRbsData> = {}): RawRbsData {
  const parser = new RbsParser();
  const base = parser.generateMockData('fixture.rbs');
  return { ...base, ...overrides };
}

function tb303Step(overrides: Partial<Tb303Step> & { index: number }): Tb303Step {
  return {
    note: 0,
    octave: 3,
    accent: false,
    slide: false,
    tie: false,
    gate: 100,
    ...overrides,
  };
}

/** Count distinct note triggers (non-null steps that start a new envelope). */
function countTriggers(steps: (Note | null)[]): number {
  return steps.filter((s) => s !== null).length;
}

/** Valid Note shape per src/types.ts */
function assertValidNote(note: Note) {
  expect(typeof note.note).toBe('string');
  expect(typeof note.velocity).toBe('number');
  expect(note.velocity).toBeGreaterThanOrEqual(0);
  expect(note.velocity).toBeLessThanOrEqual(1);
  if (note.length !== undefined) expect(note.length).toBeGreaterThan(0);
  if (note.slide !== undefined) expect(typeof note.slide).toBe('boolean');
}

describe('RbsImporter TB-303 fidelity', () => {
  it('16→32 tied note sustains without re-triggering envelope', () => {
    const steps: Tb303Step[] = Array.from({ length: 16 }, (_, i) => {
      if (i === 0) return tb303Step({ index: 0, note: 0, accent: true });
      if (i === 1) return tb303Step({ index: 1, note: -1, tie: true });
      return tb303Step({ index: i, note: -1 });
    });

    const importer = new RbsImporter({ expandTo32Steps: true });
    const result = importer.convertToHyphonSong(
      makeRaw({
        tb303PatternA: { ...makeRaw().tb303PatternA, steps },
        project: { ...makeRaw().project, patternLength: 16 },
      })
    );

    const partA = result.song.pattern.partA.steps;
    expect(partA).toHaveLength(32);

    // Single trigger at sub-step 0; tie sub-steps 2–3 are null (sustain via length)
    expect(countTriggers(partA)).toBe(1);
    expect(partA[0]).not.toBeNull();
    expect(partA[1]).toBeNull();
    expect(partA[2]).toBeNull();
    expect(partA[3]).toBeNull();
    expect(partA[0]!.length).toBe(4);
    assertValidNote(partA[0]!);
  });

  it('preserves accent on first sub-step after 16→32 expansion', () => {
    const steps: Tb303Step[] = [
      tb303Step({ index: 0, note: 5, accent: true }),
      ...Array.from({ length: 15 }, (_, i) => tb303Step({ index: i + 1, note: -1 })),
    ];

    const importer = new RbsImporter({ expandTo32Steps: true });
    const result = importer.convertToHyphonSong(
      makeRaw({
        tb303PatternA: { ...makeRaw().tb303PatternA, steps },
        project: { ...makeRaw().project, patternLength: 16 },
      })
    );

    const note0 = result.song.pattern.partA.steps[0];
    expect(note0).not.toBeNull();
    expect(note0!.velocity).toBeGreaterThan(0.8);
    expect(result.song.pattern.partA.steps[1]).toBeNull();
  });

  it('maps slide to length 2 spanning both 32nd sub-steps', () => {
    const steps: Tb303Step[] = [
      tb303Step({ index: 0, note: 7, slide: true }),
      ...Array.from({ length: 15 }, (_, i) => tb303Step({ index: i + 1, note: -1 })),
    ];

    const importer = new RbsImporter({ expandTo32Steps: true });
    const result = importer.convertToHyphonSong(
      makeRaw({
        tb303PatternA: { ...makeRaw().tb303PatternA, steps },
        project: { ...makeRaw().project, patternLength: 16 },
      })
    );

    const s0 = result.song.pattern.partA.steps[0];
    expect(s0?.slide).toBe(true);
    expect(s0?.length).toBe(2);
    expect(result.song.pattern.partA.steps[1]).toBeNull();
    expect(countTriggers(result.song.pattern.partA.steps)).toBe(1);
  });

  it('PCF sweep 0–127 produces monotonic filter-cutoff automation curve', () => {
    const pcfPattern = Array.from({ length: 16 }, (_, i) => i * 8);
    const importer = new RbsImporter({ convertPcfToAutomation: true, expandTo32Steps: false });
    const result = importer.convertToHyphonSong(
      makeRaw({
        pcf: {
          enabled: true,
          filterType: 'lp',
          cutoff: 80,
          resonance: 40,
          envAmount: 60,
          decay: 40,
          pattern: pcfPattern,
          target: { tb303A: true, tb303B: false, drums: false },
        },
      })
    );

    const lane = result.song.automation?.find((l) => l.name === 'PCF → Synth A Filter');
    expect(lane).toBeDefined();
    expect(lane!.parameter).toBe('filterCutoff');
    const values = lane!.points.map((p) => p[1]);
    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBeGreaterThanOrEqual(values[i - 1]);
    }
  });

  it('808 vs 909 kit selection maps distinct drum params', () => {
    const importer808 = new RbsImporter({ drumKitMapping: '808' });
    const importer909 = new RbsImporter({ drumKitMapping: '909' });

    const raw808 = makeRaw({ drums: { ...makeRaw().drums, kitType: '808' } });
    const raw909 = makeRaw({ drums: { ...makeRaw().drums, kitType: '909' } });

    const song808 = importer808.convertToHyphonSong(raw808).song;
    const song909 = importer909.convertToHyphonSong(raw909).song;

    expect(song808.params.drumKit).toBe('808');
    expect(song909.params.drumKit).toBe('909');
    expect(song808.params.kick.tone).toBe(0.6);
    expect(song909.params.kick.tone).toBe(0.8);
    expect(song808.params.snare.tone).toBe(200);
    expect(song909.params.snare.tone).toBe(300);
  });

  it('empty patterns and blank automation produce valid empty structures', () => {
    const emptySteps: Tb303Step[] = Array.from({ length: 16 }, (_, i) =>
      tb303Step({ index: i, note: -1 })
    );
    const importer = new RbsImporter({
      convertPcfToAutomation: false,
      expandTo32Steps: false,
    });
    const result = importer.convertToHyphonSong(
      makeRaw({
        automation: [],
        pcf: {
          enabled: false,
          filterType: 'lp',
          cutoff: 0,
          resonance: 0,
          envAmount: 0,
          decay: 0,
          pattern: Array(16).fill(0),
          target: { tb303A: false, tb303B: false, drums: false },
        },
        tb303PatternA: { ...makeRaw().tb303PatternA, steps: emptySteps },
        tb303PatternB: { ...makeRaw().tb303PatternB, steps: emptySteps },
        drums: {
          kick: Array(16).fill(false),
          snare: Array(16).fill(false),
          closedHat: Array(16).fill(false),
          openHat: Array(16).fill(false),
          accent: Array(16).fill(0),
          kitType: '808',
          tuning: { kick: 0, snare: 0, closedHat: 0, openHat: 0 },
          decay: { kick: 64, snare: 64, closedHat: 64, openHat: 64 },
        },
      })
    );

    expect(result.success).toBe(true);
    expect(result.song.pattern.partA.steps.every((s) => s === null)).toBe(true);
    expect(result.song.automation).toBeUndefined();
    expect(result.report.automationLanesConverted).toBe(0);
  });

  it('round-trips legacy synthesized file through parser → importer', async () => {
    const bytes = buildLegacyRbsFile({ tempo: 140, kitType: '909' });
    const parsed = await new RbsParser().parseBytes(bytes, { filename: 't.rbs', requireExtension: false });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    const imported = new RbsImporter().convertToHyphonSong(parsed.data);
    expect(imported.song.tempo).toBe(140);
    expect(imported.song.params.drumKit).toBe('909');
    expect(imported.song.pattern.partA.steps).toHaveLength(32);
  });
});
