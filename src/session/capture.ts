import { TRACK_KEYS } from '@/constants';
import { NUM_STEPS } from '@/constants';
import type { TrackKey } from '@/constants/appDefaults';
import type { SongMeasure, SongStructure } from '@/types/songMode';
import { createEmptyMeasure } from '@/utils/songModeEditing';
import type { SessionCaptureEvent } from './types';

export const SESSION_STEPS_PER_MEASURE = 16;

/**
 * Compile a captured live-launch performance into Song Mode measures.
 * Each measure holds the last launched slot per track (null = stopped / empty).
 * Order and quantized step timing are preserved by expanding the timeline.
 */
export function captureEventsToSongStructure(
  events: SessionCaptureEvent[],
  options?: { stepsPerMeasure?: number; minMeasures?: number },
): SongStructure {
  const spm = options?.stepsPerMeasure ?? SESSION_STEPS_PER_MEASURE;
  const minMeasures = options?.minMeasures ?? 1;
  if (events.length === 0) {
    return Array.from({ length: minMeasures }, () => createEmptyMeasure());
  }

  const lastTimeline = Math.max(...events.map((e) => e.timelineStep));
  const measureCount = Math.max(minMeasures, Math.floor(lastTimeline / spm) + 1);

  const slotAt = {} as Record<TrackKey, number | null>;
  for (const t of TRACK_KEYS) slotAt[t] = null;

  const byTime = [...events].sort((a, b) => a.timelineStep - b.timelineStep);
  let ei = 0;
  const measures: SongMeasure[] = [];

  for (let m = 0; m < measureCount; m++) {
    const start = m * spm;
    const end = start + spm;
    while (ei < byTime.length && byTime[ei].timelineStep < end) {
      const ev = byTime[ei];
      if (ev.action === 'stop') slotAt[ev.track] = null;
      else slotAt[ev.track] = ev.slotIndex;
      ei += 1;
    }
    const measure = createEmptyMeasure();
    for (const t of TRACK_KEYS) {
      measure[t] = slotAt[t];
    }
    measures.push(measure);
  }

  return measures;
}

/** Replay helper: restore capture events as launch intents at their timeline steps. */
export function songStructureSlotAt(
  structure: SongStructure,
  measure: number,
  track: TrackKey,
): number | null {
  return structure[measure]?.[track] ?? null;
}

export { NUM_STEPS };
