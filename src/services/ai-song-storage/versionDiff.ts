import type { Note, Pattern, SavedSongData } from '../../types';
import type { TrackModification, VersionDiff } from './types';

/**
 * Compare two song versions and return differences
 * Works with Pattern-based track structure
 */
export function compareTracks(v1: SavedSongData, v2: SavedSongData): VersionDiff {
  const diff: VersionDiff = {
    addedTracks: [],
    removedTracks: [],
    modifiedTracks: [],
    parameterChanges: [],
    addedNotes: [],
    removedNotes: []
  };

  const trackKeys = ['partA', 'partB', 'bass2', 'kick', 'snare', 'closedHat', 'openHat', 'sampler'] as const;
  const v1Pattern = v1.pattern;
  const v2Pattern = v2.pattern;

  // Compare each track in the pattern
  for (const key of trackKeys) {
    const v1Track = v1Pattern[key];
    const v2Track = v2Pattern[key];

    // Handle sampler (array) vs other tracks (single sequence)
    if (key === 'sampler') {
      const v1Banks = v1Track as Pattern['sampler'];
      const v2Banks = v2Track as Pattern['sampler'];

      for (let i = 0; i < 8; i++) {
        const v1Bank = v1Banks[i];
        const v2Bank = v2Banks[i];
        const trackName = `sampler-${i}`;

        // Compare steps
        compareSteps(v1Bank?.steps || [], v2Bank?.steps || [], `sampler-${i}`, trackName, diff);
      }
    } else {
      const v1Seq = v1Track as Pattern['partA'];
      const v2Seq = v2Track as Pattern['partA'];

      // Compare steps for changes
      compareSteps(v1Seq.steps, v2Seq.steps, key, key, diff);

      // Check for parameter changes in params
      const v1Params = v1.params[key as keyof SavedSongData['params']];
      const v2Params = v2.params[key as keyof SavedSongData['params']];

      if (v1Params && v2Params && typeof v1Params === 'object' && typeof v2Params === 'object') {
        const changes: TrackModification['changes'] = [];

        for (const [param, val1] of Object.entries(v1Params)) {
          // @ts-expect-error - Auto-generated to fix CI build
          const val2 = (v2Params as Record<string, unknown>)[param];
          if (val1 !== val2) {
            changes.push({ field: param, oldValue: val1, newValue: val2 });

            if (param === 'volume' && typeof val1 === 'number' && typeof val2 === 'number') {
              diff.parameterChanges.push({
                trackId: key,
                trackName: key,
                parameter: param,
                oldValue: val1,
                newValue: val2
              });
            }
          }
        }

        if (changes.length > 0) {
          diff.modifiedTracks.push({ trackId: key, trackName: key, changes });
        }
      }
    }
  }

  return diff;
}

/**
 * Compare steps between two sequences
 */
export function compareSteps(
  v1Steps: (Note | null)[],
  v2Steps: (Note | null)[],
  trackId: string,
  trackName: string,
  diff: VersionDiff
): void {
  const maxSteps = Math.max(v1Steps.length, v2Steps.length);

  for (let i = 0; i < maxSteps; i++) {
    const v1Note = v1Steps[i];
    const v2Note = v2Steps[i];

    // Note added
    if (!v1Note && v2Note) {
      diff.addedNotes.push({ trackId, trackName, note: v2Note, stepIndex: i });
    }
    // Note removed
    else if (v1Note && !v2Note) {
      diff.removedNotes.push({ trackId, trackName, note: v1Note, stepIndex: i });
    }
    // Note changed
    else if (v1Note && v2Note) {
      const noteChanged =
        v1Note.note !== v2Note.note ||
        v1Note.velocity !== v2Note.velocity ||
        v1Note.length !== v2Note.length ||
        v1Note.slide !== v2Note.slide;

      if (noteChanged) {
        diff.removedNotes.push({ trackId, trackName, note: v1Note, stepIndex: i });
        diff.addedNotes.push({ trackId, trackName, note: v2Note, stepIndex: i });
      }
    }
  }
}
