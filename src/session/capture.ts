import { TRACK_KEYS } from '@/constants';
import { NUM_STEPS } from '@/constants';
import type { TrackKey } from '@/constants/appDefaults';
import type { SongMeasure, SongStructure } from '@/types/songMode';
import type { Arrangement, ArrangementClip } from '@/types/song';
import { createEmptyMeasure } from '@/utils/songModeEditing';
import { createArrangement, placeClip } from '@/arrangement/model';
import type { SessionCaptureEvent } from './types';

/**
 * Fallback measure length. Callers pass the song's `stepCount` so captured
 * measures line up with Song Mode playback (one measure = one pattern loop).
 */
export const SESSION_STEPS_PER_MEASURE = NUM_STEPS;

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

  // ⚡ Bolt Optimization: Replace Math.max(...events.map()) with a standard for loop
  // This avoids intermediate array allocation and prevents "Maximum call stack size exceeded" errors on long captures
  let lastTimeline = 0;
  for (let i = 0; i < events.length; i++) {
    const step = events[i].timelineStep;
    if (step > lastTimeline) lastTimeline = step;
  }
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

/**
 * Compile a captured performance into arrangement clips that keep their
 * identity: each launch becomes a clip (slot + real start + length) that runs
 * until the next launch or stop on its track, or the end of the capture.
 *
 * The timeline starts at the bar of the first launch (`stepsPerMeasure`
 * grid), and the capture ends at `endStep` (the session timeline step when
 * CAPTURE was released) rounded up to a measure — or, without it, at the end
 * of the measure holding the last launch, as Song Mode capture did.
 */
export function captureEventsToArrangement(
  events: SessionCaptureEvent[],
  options?: { stepsPerMeasure?: number; endStep?: number },
): Arrangement {
  const spm = Math.max(1, options?.stepsPerMeasure ?? SESSION_STEPS_PER_MEASURE);
  if (events.length === 0) return createArrangement(spm);

  const byTime = [...events].sort((a, b) => a.timelineStep - b.timelineStep);
  const first = byTime[0].timelineStep;
  const last = byTime[byTime.length - 1].timelineStep;
  const origin = Math.floor(first / spm) * spm;
  let end = (Math.floor(last / spm) + 1) * spm;
  if (options?.endStep !== undefined && options.endStep > last) {
    end = Math.max(end, Math.ceil(options.endStep / spm) * spm);
  }

  const clips: ArrangementClip[] = [];
  const open = {} as Record<TrackKey, { slot: number; start: number } | null>;
  for (const t of TRACK_KEYS) open[t] = null;
  const close = (track: TrackKey, at: number) => {
    const o = open[track];
    open[track] = null;
    if (!o || at <= o.start) return;
    clips.push({
      id: `clip-${clips.length + 1}`,
      track,
      patternSlot: o.slot,
      startStep: o.start - origin,
      lengthSteps: at - o.start,
      loop: true,
    });
  };

  for (const ev of byTime) {
    close(ev.track, ev.timelineStep);
    if (ev.action !== 'stop' && ev.slotIndex !== null) {
      open[ev.track] = { slot: ev.slotIndex, start: ev.timelineStep };
    }
  }
  for (const t of TRACK_KEYS) close(t, end);

  // Rebuild through placeClip so ids, ordering and length are canonical.
  let arrangement = createArrangement(end - origin);
  for (const clip of clips) arrangement = placeClip(arrangement, clip);
  return arrangement;
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
