import { describe, expect, it } from 'vitest';
import { convertToHyphonSong } from '../importers/smf/SmfImporter';
import type { ParsedSmf, SmfNoteEvent, SmfControlChangeEvent } from '../importers/smf/types';

const PPQ = 96;
const TICKS_PER_STEP = PPQ / 4;

function note(overrides: Partial<SmfNoteEvent> & Pick<SmfNoteEvent, 'channel' | 'note' | 'startTick' | 'endTick'>): SmfNoteEvent {
  return { trackIndex: 0, velocity: 100, ...overrides };
}

function baseParsed(overrides: Partial<ParsedSmf> = {}): ParsedSmf {
  return {
    format: 0,
    ppq: PPQ,
    trackCount: 1,
    tracks: [{ index: 0, endTick: 0 }],
    notes: [],
    controlChanges: [],
    programChanges: [],
    tempoMap: [{ tick: 0, microsecondsPerQuarter: 500000, bpm: 120 }],
    timeSignatures: [{ tick: 0, numerator: 4, denominator: 4 }],
    totalTicks: 0,
    warnings: [],
    ...overrides,
  };
}

describe('SmfImporter', () => {
  it('quantizes a note on channel 1 onto partA step 0', () => {
    const parsed = baseParsed({ notes: [note({ channel: 0, note: 60, startTick: 0, endTick: TICKS_PER_STEP })] });
    const result = convertToHyphonSong(parsed);
    expect(result.success).toBe(true);
    expect(result.song.pattern.partA.steps[0]).toMatchObject({ note: 'C4' });
    expect(result.report.notesImported).toBe(1);
  });

  it('routes channel 2 to partB and channel 3 to bass2 by default', () => {
    const parsed = baseParsed({
      notes: [
        note({ channel: 1, note: 62, startTick: 0, endTick: TICKS_PER_STEP }),
        note({ channel: 2, note: 43, startTick: TICKS_PER_STEP * 2, endTick: TICKS_PER_STEP * 3 }),
      ],
    });
    const result = convertToHyphonSong(parsed);
    expect(result.song.pattern.partB.steps[0]).toMatchObject({ note: 'D4' });
    expect(result.song.pattern.bass2.steps[2]).toMatchObject({ note: 'G2' });
  });

  it('maps GM kick/snare/closed-hat/open-hat notes on channel 10 to drum tracks', () => {
    const parsed = baseParsed({
      notes: [
        note({ channel: 9, note: 36, startTick: 0, endTick: TICKS_PER_STEP }), // kick
        note({ channel: 9, note: 38, startTick: TICKS_PER_STEP * 4, endTick: TICKS_PER_STEP * 5 }), // snare
        note({ channel: 9, note: 42, startTick: TICKS_PER_STEP * 2, endTick: TICKS_PER_STEP * 3 }), // closed hat
        note({ channel: 9, note: 46, startTick: TICKS_PER_STEP * 6, endTick: TICKS_PER_STEP * 7 }), // open hat
      ],
    });
    const result = convertToHyphonSong(parsed);
    expect(result.song.pattern.kick.steps[0]).not.toBeNull();
    expect(result.song.pattern.snare.steps[4]).not.toBeNull();
    expect(result.song.pattern.closedHat.steps[2]).not.toBeNull();
    expect(result.song.pattern.openHat.steps[6]).not.toBeNull();
    expect(result.report.drumGmMisses).toBe(0);
  });

  it('routes an unmapped GM drum note to sampler bank 0 and reports the miss', () => {
    const parsed = baseParsed({ notes: [note({ channel: 9, note: 49, startTick: 0, endTick: TICKS_PER_STEP })] }); // 49 = crash cymbal, not in GM_DRUM_NOTE_MAP
    const result = convertToHyphonSong(parsed);
    expect(result.report.drumGmMisses).toBe(1);
    expect(result.song.pattern.sampler[0]?.steps[0]).not.toBeNull();
  });

  it('converts velocity 1-127 to a 0-1 normalized range', () => {
    const parsed = baseParsed({ notes: [note({ channel: 0, note: 60, startTick: 0, endTick: TICKS_PER_STEP, velocity: 64 })] });
    const result = convertToHyphonSong(parsed);
    const step = result.song.pattern.partA.steps[0];
    expect(step?.velocity).toBeCloseTo(64 / 127, 5);
  });

  it('sets Note.length for notes longer than one step', () => {
    const parsed = baseParsed({ notes: [note({ channel: 0, note: 60, startTick: 0, endTick: TICKS_PER_STEP * 3 })] });
    const result = convertToHyphonSong(parsed);
    expect(result.song.pattern.partA.steps[0]?.length).toBe(3);
  });

  it('flags a non-4/4 time signature as a mismatch warning', () => {
    const parsed = baseParsed({ timeSignatures: [{ tick: 0, numerator: 3, denominator: 4 }] });
    const result = convertToHyphonSong(parsed);
    expect(result.report.timeSignatureMismatch).toBe(true);
    expect(result.report.warnings.some((w) => w.includes('3/4'))).toBe(true);
  });

  it('counts tempo changes after the first pattern', () => {
    const parsed = baseParsed({
      tempoMap: [
        { tick: 0, microsecondsPerQuarter: 500000, bpm: 120 },
        { tick: TICKS_PER_STEP * 40, microsecondsPerQuarter: 400000, bpm: 150 },
      ],
    });
    const result = convertToHyphonSong(parsed);
    expect(result.report.tempoChangesAfterBar1).toBe(1);
  });

  it('converts CC74 on a routed channel into a filter-cutoff automation lane', () => {
    const cc: SmfControlChangeEvent = { trackIndex: 0, channel: 0, controller: 74, value: 64, tick: TICKS_PER_STEP * 4 };
    const parsed = baseParsed({
      notes: [note({ channel: 0, note: 60, startTick: 0, endTick: TICKS_PER_STEP })],
      controlChanges: [cc],
    });
    const result = convertToHyphonSong(parsed);
    expect(result.report.automationLanesConverted).toBe(1);
    expect(result.song.automation?.[0]).toMatchObject({ target: 'synthA', parameter: 'filterCutoff' });
    expect(result.song.automation?.[0].points[0][1]).toBeCloseTo(64 / 127, 5);
  });

  it('skips CC74 with a report row when no synth track is routed to that channel', () => {
    const cc: SmfControlChangeEvent = { trackIndex: 0, channel: 5, controller: 74, value: 64, tick: 0 };
    const parsed = baseParsed({ controlChanges: [cc] });
    const result = convertToHyphonSong(parsed);
    expect(result.report.automationLanesConverted).toBe(0);
    expect(result.report.warnings.some((w) => w.includes('CC74'))).toBe(true);
  });

  it('reports (without crashing) when a file has no notes at all', () => {
    const parsed = baseParsed({ notes: [] });
    const result = convertToHyphonSong(parsed);
    expect(result.success).toBe(true);
    expect(result.report.notesImported).toBe(0);
    expect(result.report.warnings.some((w) => w.toLowerCase().includes('no notes'))).toBe(true);
  });

  it('spans multiple 32-step patterns and builds a songArrangement + songStructure', () => {
    const notes: SmfNoteEvent[] = [];
    for (let p = 0; p < 3; p++) {
      notes.push(note({ channel: 0, note: 60, startTick: p * 32 * TICKS_PER_STEP, endTick: p * 32 * TICKS_PER_STEP + TICKS_PER_STEP }));
    }
    const parsed = baseParsed({ notes });
    const result = convertToHyphonSong(parsed);
    expect(result.song.songArrangement).toBeDefined();
    expect(result.song.songArrangement?.songStructure.length).toBeGreaterThanOrEqual(3);
    const patternTwo = result.song.songArrangement?.trackStorage.partA[2];
    expect(patternTwo && !Array.isArray(patternTwo) ? patternTwo.steps[0] : null).toBeTruthy();
  });
});
