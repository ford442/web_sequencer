import { describe, expect, it } from 'vitest';
import { SmfExporter } from '../importers/smf/SmfExporter';
import { parseSmfBytes } from '../importers/smf/SmfParser';
import { convertToHyphonSong } from '../importers/smf/SmfImporter';
import { createEmptyTrackStorage } from '../utils/trackStorageUtils';
import { EMPTY_PATTERN } from '../constants/appDefaults';
import type { Pattern } from '../types';
import type { TrackKey } from '../constants/appDefaults';

describe('SmfExporter', () => {
  it('exports a 32-step kick+synthA pattern and round-trips ticks within one 16th note', () => {
    const pattern: Pattern = {
      ...EMPTY_PATTERN,
      partA: { steps: Array(32).fill(null).map((_, i) => (i % 8 === 0 ? { note: 'C4', velocity: 0.8 } : null)) },
      kick: { steps: Array(32).fill(null).map((_, i) => (i % 4 === 0 ? { note: 'C2', velocity: 1 } : null)) },
    };

    const exporter = new SmfExporter();
    const result = exporter.exportToBytes(
      { songStructure: [], trackStorage: createEmptyTrackStorage(), currentPattern: pattern, tempo: 120 },
      { useSongMode: false },
    );
    expect(result.success).toBe(true);
    if (!result.success || !result.bytes) return;

    const parsed = parseSmfBytes(result.bytes, { filename: 'roundtrip.mid' });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    const imported = convertToHyphonSong(parsed.data);
    expect(imported.success).toBe(true);

    // 8 kick hits (every 4th of 32 steps) + 4 partA hits (every 8th of 32 steps) = 12 notes.
    expect(parsed.data.notes.length).toBe(12);

    const ticksPerStep = parsed.data.ppq / 4;
    for (const note of parsed.data.notes) {
      const nearestStep = Math.round(note.startTick / ticksPerStep);
      const drift = Math.abs(note.startTick - nearestStep * ticksPerStep);
      expect(drift).toBeLessThanOrEqual(ticksPerStep); // within one 16th note
    }

    expect(imported.song.pattern.partA.steps[0]).toMatchObject({ note: 'C4' });
    expect(imported.song.pattern.kick.steps[0]).toMatchObject({ note: 'C2' });
    expect(imported.song.pattern.kick.steps[4]).not.toBeNull();
  });

  it('round-trips a 3/4 song: meter in the conductor track, 24-step patterns, identical note ticks', () => {
    const steps24 = (hits: number[], note: string) =>
      Array.from({ length: 24 }, (_, i) => (hits.includes(i) ? { note, velocity: 1 } : null));
    const trackStorage = createEmptyTrackStorage();
    trackStorage.partA[0] = { steps: steps24([0, 5, 23], 'C4') };
    trackStorage.partA[1] = { steps: steps24([2, 12], 'E4') };
    const songStructure: Array<Record<TrackKey, number | null>> = [
      { partA: 0, partB: null, bass2: null, kick: null, snare: null, closedHat: null, openHat: null, sampler: null },
      { partA: 1, partB: null, bass2: null, kick: null, snare: null, closedHat: null, openHat: null, sampler: null },
    ];

    const result = new SmfExporter().exportToBytes(
      { songStructure, trackStorage, currentPattern: EMPTY_PATTERN, tempo: 100, timeSignature: [3, 4], stepCount: 24 },
      { useSongMode: true },
    );
    expect(result.success).toBe(true);
    if (!result.bytes) return;

    const parsed = parseSmfBytes(result.bytes, { filename: 'three-four.mid' });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.timeSignatures[0]).toMatchObject({ numerator: 3, denominator: 4 });

    const ticksPerStep = parsed.data.ppq / 4;
    const startTicks = parsed.data.notes.map((n) => n.startTick).sort((a, b) => a - b);
    // Measure 1 hits 0/5/23, measure 2 (offset 24) hits 2/12 — a step is one 16th.
    expect(startTicks).toEqual([0, 5, 23, 24 + 2, 24 + 12].map((step) => step * ticksPerStep));

    const imported = convertToHyphonSong(parsed.data);
    expect(imported.report.timeSignatureMismatch).toBe(false);
    expect(imported.song.timeSignature).toEqual([3, 4]);
    expect(imported.song.stepCount).toBe(24);
    const slots = imported.song.songArrangement!.trackStorage.partA;
    const hitsOf = (slot: number) =>
      ((slots[slot] as { steps: unknown[] }).steps)
        .map((s, i) => (s ? i : -1))
        .filter((i) => i >= 0);
    expect(hitsOf(0)).toEqual([0, 5, 23]);
    expect(hitsOf(1)).toEqual([2, 12]);
  });

  it('defaults the conductor track to 4/4 when no meter is given', () => {
    const result = new SmfExporter().exportToBytes(
      { songStructure: [], trackStorage: createEmptyTrackStorage(), currentPattern: EMPTY_PATTERN, tempo: 120 },
      { useSongMode: false },
    );
    const parsed = parseSmfBytes(result.bytes!, { filename: 'default.mid' });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.timeSignatures[0]).toMatchObject({ numerator: 4, denominator: 4 });
  });

  it('song-mode export writes concatenated clips in SongStructure order', () => {
    const trackStorage = createEmptyTrackStorage();
    const patternA = { steps: Array(32).fill(null).map((_, i) => (i === 0 ? { note: 'C4', velocity: 1 } : null)) };
    const patternB = { steps: Array(32).fill(null).map((_, i) => (i === 0 ? { note: 'E4', velocity: 1 } : null)) };
    trackStorage.partA[0] = patternA;
    trackStorage.partA[1] = patternB;

    const songStructure: Array<Record<TrackKey, number | null>> = [
      { partA: 0, partB: null, bass2: null, kick: null, snare: null, closedHat: null, openHat: null, sampler: null },
      { partA: 1, partB: null, bass2: null, kick: null, snare: null, closedHat: null, openHat: null, sampler: null },
    ];

    const exporter = new SmfExporter();
    const result = exporter.exportToBytes(
      { songStructure, trackStorage, currentPattern: EMPTY_PATTERN, tempo: 120 },
      { useSongMode: true },
    );
    expect(result.success).toBe(true);
    if (!result.success || !result.bytes) return;

    const parsed = parseSmfBytes(result.bytes, { filename: 'song.mid' });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    // Measure 0's C4 at step 0, measure 1's E4 at step 32 (concatenated, not overlapped).
    const ticksPerStep = parsed.data.ppq / 4;
    const notesSorted = [...parsed.data.notes].sort((a, b) => a.startTick - b.startTick);
    expect(notesSorted).toHaveLength(2);
    expect(notesSorted[0].note).toBe(60); // C4
    expect(notesSorted[0].startTick).toBe(0);
    expect(notesSorted[1].note).toBe(64); // E4
    expect(notesSorted[1].startTick).toBe(32 * ticksPerStep);
  });

  it('reports a warning instead of producing an empty file when every track is empty', () => {
    const exporter = new SmfExporter();
    const result = exporter.exportToBytes(
      { songStructure: [], trackStorage: createEmptyTrackStorage(), currentPattern: EMPTY_PATTERN, tempo: 120 },
      { useSongMode: false },
    );
    expect(result.success).toBe(true);
    expect(result.warnings.some((w) => w.toLowerCase().includes('empty'))).toBe(true);
  });
});
