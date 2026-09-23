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
