/**
 * Hyphon song arrangement → TRAK wire events (inverse of songArrangement import).
 * Controller IDs come from trakControllers.ts (single source of truth with import).
 */

import type { HyphonSong, RbsTrakEvent } from './types';
import { TICKS_PER_BAR, TRAK_TRACK_INDEX } from './types';
import {
  TB303_TRAK_CONTROLLER,
  DRUM_TRAK_CONTROLLER,
  isTrakPatternSelectEvent,
} from './trakControllers';

export const TRKL_TRACK_COUNT = 9;

export interface TrakWireEvent {
  delta: number;
  ctrl: number;
  value: number;
}

/** Convert absolute-tick TRAK events to delta-encoded wire format for one track. */
export function trakEventsToWireFormat(events: RbsTrakEvent[]): TrakWireEvent[] {
  if (events.length === 0) return [];

  const sorted = [...events].sort((a, b) => a.absoluteTicks - b.absoluteTicks);
  let prevTick = 0;
  return sorted.map((ev) => {
    const delta = ev.absoluteTicks - prevTick;
    prevTick = ev.absoluteTicks;
    return {
      delta,
      ctrl: ev.controllerId,
      value: ev.value,
    };
  });
}

/**
 * Build pattern-select TRAK events from Hyphon songStructure for one track slot key.
 * Emits an event only when the pattern index changes between bars.
 */
export function buildPatternSelectEventsFromStructure(
  songStructure: Array<Record<string, number | null>>,
  slotKey: string,
  controllerId: number,
): TrakWireEvent[] {
  const events: TrakWireEvent[] = [];
  let lastValue: number | null = null;
  let ticksSinceLastEvent = 0;

  for (let bar = 0; bar < songStructure.length; bar++) {
    const raw = songStructure[bar][slotKey];
    if (raw === null || raw === undefined) {
      ticksSinceLastEvent += TICKS_PER_BAR;
      continue;
    }

    const value = raw;
    if (value !== lastValue) {
      events.push({
        delta: events.length === 0 ? 0 : ticksSinceLastEvent,
        ctrl: controllerId,
        value,
      });
      lastValue = value;
      ticksSinceLastEvent = TICKS_PER_BAR;
    } else {
      ticksSinceLastEvent += TICKS_PER_BAR;
    }
  }

  return events;
}

function emptyTrakTracks(): Array<{ events: TrakWireEvent[] }> {
  return Array.from({ length: TRKL_TRACK_COUNT }, () => ({ events: [] }));
}

/**
 * Build per-track TRAK event lists for IFF TRKL export.
 * Prefers preserved trakEvents (accurate round-trip); falls back to songStructure.
 */
export function buildSongModeTrakTracks(
  song: HyphonSong,
): Array<{ events: TrakWireEvent[] }> {
  const arrangement = song.songArrangement;
  const tracks = emptyTrakTracks();
  if (!arrangement) return tracks;

  const preserved = arrangement.trakEvents ?? [];
  if (preserved.length > 0) {
    const byTrack = new Map<number, RbsTrakEvent[]>();
    for (const ev of preserved) {
      const list = byTrack.get(ev.trackIndex) ?? [];
      list.push(ev);
      byTrack.set(ev.trackIndex, list);
    }
    for (const [trackIndex, events] of byTrack) {
      if (trackIndex >= 0 && trackIndex < TRKL_TRACK_COUNT) {
        tracks[trackIndex].events = trakEventsToWireFormat(events);
      }
    }
    return tracks;
  }

  const structure = arrangement.songStructure;
  tracks[TRAK_TRACK_INDEX.TB303_1].events = buildPatternSelectEventsFromStructure(
    structure,
    'partA',
    TB303_TRAK_CONTROLLER.PATTERN_SELECT,
  );
  tracks[TRAK_TRACK_INDEX.TB303_2].events = buildPatternSelectEventsFromStructure(
    structure,
    'partB',
    TB303_TRAK_CONTROLLER.PATTERN_SELECT,
  );

  const drumKit = song.params.drumKit ?? '808';
  const drumTrackIndex = drumKit === '909' ? TRAK_TRACK_INDEX.TR909 : TRAK_TRACK_INDEX.TR808;
  tracks[drumTrackIndex].events = buildPatternSelectEventsFromStructure(
    structure,
    'kick',
    DRUM_TRAK_CONTROLLER.PATTERN_SELECT,
  );

  return tracks;
}

/** Count non-null pattern slots used across track storage banks. */
export function countUsedPatternSlots(
  trackStorage: NonNullable<HyphonSong['songArrangement']>['trackStorage'],
): number {
  let max = 1;
  for (const slots of Object.values(trackStorage)) {
    if (!Array.isArray(slots)) continue;
    for (let i = slots.length - 1; i >= 0; i--) {
      if (slots[i] !== null) {
        max = Math.max(max, i + 1);
        break;
      }
    }
  }
  return max;
}

/** Summarize pattern-select events for export warnings / validation. */
export function summarizePatternSelectUsage(
  events: RbsTrakEvent[],
): { maxPatternIndex: number; eventCount: number } {
  let maxPatternIndex = 0;
  let eventCount = 0;
  for (const ev of events) {
    if (isTrakPatternSelectEvent(ev.trackIndex, ev.controllerId, ev.eventKind)) {
      eventCount++;
      maxPatternIndex = Math.max(maxPatternIndex, ev.value);
    }
  }
  return { maxPatternIndex, eventCount };
}
