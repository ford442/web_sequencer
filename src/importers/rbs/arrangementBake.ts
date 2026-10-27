/**
 * Arrangement timeline → ReBirth song (#1494).
 *
 * ReBirth plays one pattern per bar per device. The arrangement can hold
 * trimmed clips, gaps and one-shot tails that no Song Mode cell can express,
 * so the `.rbs` song is baked from `resolveArrangementTimeline` — the walk
 * live playback and every other export use — instead of the projection:
 * each measure of the timeline becomes one pattern per device (identical
 * measures share a slot), and a measure with nothing playing on a device
 * selects an empty pattern, so gaps stay rests. Devices are baked
 * independently, the way ReBirth selects them: TB-303 #1 (`partA`), TB-303 #2
 * (`partB` / `bass2`, whichever the export uses, read through the `partB`
 * column), and the drum machine (the four drum tracks, `kick` column).
 */
import { MAX_TRACK_PATTERN_SLOTS } from '../../constants';
import type { TrackKey } from '../../constants/appDefaults';
import type { Arrangement, PartSequence } from '../../types';
import { resolveArrangementTimeline, type TimelineMeter } from '../../utils/songTimeline';

const BAKED_TRACKS = ['partA', 'partB', 'bass2', 'kick', 'snare', 'closedHat', 'openHat'] as const;
type BakedTrack = (typeof BAKED_TRACKS)[number];

/** Tracks that share one ReBirth pattern select. */
const DEVICES: ReadonlyArray<readonly BakedTrack[]> = [
  ['partA'],
  ['partB', 'bass2'],
  ['kick', 'snare', 'closedHat', 'openHat'],
];

export interface BakedRbsArrangement {
  trackStorage: Record<BakedTrack, (PartSequence | null)[]>;
  /** One row per measure; the tracks of a device select the same slot. */
  songStructure: Array<Record<TrackKey, number | null>>;
  warnings: string[];
}

function sliceMeasure(seq: PartSequence, from: number, rows: number, stepCount: number): PartSequence {
  const steps: PartSequence['steps'] = new Array(stepCount).fill(null);
  for (let i = 0; i < rows; i++) steps[i] = seq.steps[from + i] ?? null;
  const out: PartSequence = { steps };
  if (seq.automation) {
    out.automation = {};
    for (const [param, values] of Object.entries(seq.automation)) {
      const lane = new Array<number | null>(stepCount).fill(null);
      for (let i = 0; i < rows; i++) lane[i] = values[from + i] ?? null;
      out.automation[param] = lane;
    }
  }
  return out;
}

export function bakeArrangementForRbs(
  arrangement: Arrangement,
  trackStorage: Parameters<typeof resolveArrangementTimeline>[1],
  meter: TimelineMeter & { stepCount: number },
): BakedRbsArrangement {
  const timeline = resolveArrangementTimeline(arrangement, trackStorage, meter);
  const baked = Object.fromEntries(BAKED_TRACKS.map((t) => [t, [] as (PartSequence | null)[]])) as BakedRbsArrangement['trackStorage'];
  const songStructure: BakedRbsArrangement['songStructure'] = [];
  const warnings: string[] = [];
  const slotsByDevice = DEVICES.map(() => new Map<string, number>());

  let from = 0;
  for (let m = 0; m < timeline.measureStepCounts.length; m++) {
    const rows = timeline.measureStepCounts[m];
    const row: Record<TrackKey, number | null> = {
      partA: null, partB: null, bass2: null, kick: null,
      snare: null, closedHat: null, openHat: null, sampler: null,
    };
    const pending: Array<() => void> = [];
    let full = false;
    DEVICES.forEach((tracks, d) => {
      const measure = tracks.map((t) => sliceMeasure(timeline.sequences[t], from, rows, meter.stepCount));
      const key = JSON.stringify(measure);
      const slots = slotsByDevice[d];
      let slot = slots.get(key);
      if (slot === undefined) {
        if (slots.size >= MAX_TRACK_PATTERN_SLOTS) {
          full = true;
          return;
        }
        const next = slots.size;
        slot = next;
        pending.push(() => {
          slots.set(key, next);
          tracks.forEach((t, i) => { baked[t][next] = measure[i]; });
        });
      }
      for (const t of tracks) row[t] = slot;
    });
    if (full) {
      warnings.push(
        `The arrangement needs more than ${MAX_TRACK_PATTERN_SLOTS} distinct bars on one device; ReBirth holds ${MAX_TRACK_PATTERN_SLOTS} patterns per device — exporting the first ${m} bars.`,
      );
      break;
    }
    for (const commit of pending) commit();
    songStructure.push(row);
    from += rows;
  }
  return { trackStorage: baked, songStructure, warnings };
}
