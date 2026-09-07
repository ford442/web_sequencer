/**
 * Hyphon song arrangement → TRAK wire events (inverse of songArrangement import).
 * Controller IDs come from trakControllers.ts (single source of truth with import).
 */

import type { HyphonAutomationLane, HyphonSong, RbsTrakEvent } from './types';
import { TICKS_PER_BAR, TICKS_PER_STEP, TRAK_TRACK_INDEX } from './types';
import {
  TB303_TRAK_CONTROLLER,
  DRUM_TRAK_CONTROLLER,
  isTrakParamAutomationEvent,
  isTrakPatternSelectEvent,
  resolveHyphonLaneToTrak,
  resolveTrakEventKind,
  type TrakEventKind,
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

function groupEventsByTrack(events: RbsTrakEvent[]): Array<{ events: TrakWireEvent[] }> {
  const tracks = emptyTrakTracks();
  const byTrack = new Map<number, RbsTrakEvent[]>();
  for (const ev of events) {
    const list = byTrack.get(ev.trackIndex) ?? [];
    list.push(ev);
    byTrack.set(ev.trackIndex, list);
  }
  for (const [trackIndex, trackEvents] of byTrack) {
    if (trackIndex >= 0 && trackIndex < TRKL_TRACK_COUNT) {
      tracks[trackIndex].events = trakEventsToWireFormat(trackEvents);
    }
  }
  return tracks;
}

function wireToAbsoluteEvents(
  events: TrakWireEvent[],
  trackIndex: number,
  eventKind: TrakEventKind,
): RbsTrakEvent[] {
  let abs = 0;
  return events.map((ev) => {
    abs += ev.delta;
    return {
      deltaTicks: ev.delta,
      absoluteTicks: abs,
      trackIndex,
      controllerId: ev.ctrl,
      value: ev.value,
      eventKind,
    };
  });
}

/** Convert Hyphon automation lanes into TRAK param-change events. */
export function trakEventsFromAutomationLanes(lanes: HyphonAutomationLane[]): RbsTrakEvent[] {
  const events: RbsTrakEvent[] = [];
  for (const lane of lanes) {
    const mapping = resolveHyphonLaneToTrak(lane.target, lane.parameter);
    if (!mapping) continue;
    const eventKind = resolveTrakEventKind(mapping.trackIndex, mapping.controllerId);
    for (const [step, value] of lane.points) {
      events.push({
        deltaTicks: 0,
        absoluteTicks: Math.max(0, Math.round(step * TICKS_PER_STEP)),
        trackIndex: mapping.trackIndex,
        controllerId: mapping.controllerId,
        value: Math.max(0, Math.min(127, Math.round(value * 127))),
        eventKind,
      });
    }
  }
  return events;
}

function synthesizeArrangementEvents(song: HyphonSong): RbsTrakEvent[] {
  const arrangement = song.songArrangement;
  if (!arrangement) return [];

  const structure = arrangement.songStructure;
  const collected: RbsTrakEvent[] = [];

  collected.push(
    ...wireToAbsoluteEvents(
      buildPatternSelectEventsFromStructure(
        structure,
        'partA',
        TB303_TRAK_CONTROLLER.PATTERN_SELECT,
      ),
      TRAK_TRACK_INDEX.TB303_1,
      'patternSelect',
    ),
  );
  collected.push(
    ...wireToAbsoluteEvents(
      buildPatternSelectEventsFromStructure(
        structure,
        'partB',
        TB303_TRAK_CONTROLLER.PATTERN_SELECT,
      ),
      TRAK_TRACK_INDEX.TB303_2,
      'patternSelect',
    ),
  );

  const drumKit = song.params.drumKit ?? '808';
  const drumTrackIndex = drumKit === '909' ? TRAK_TRACK_INDEX.TR909 : TRAK_TRACK_INDEX.TR808;
  collected.push(
    ...wireToAbsoluteEvents(
      buildPatternSelectEventsFromStructure(
        structure,
        'kick',
        DRUM_TRAK_CONTROLLER.PATTERN_SELECT,
      ),
      drumTrackIndex,
      'patternSelect',
    ),
  );

  const paramEvents = arrangement.trakParamEvents ?? [];
  collected.push(...paramEvents);

  const hasParamChange = collected.some((ev) =>
    isTrakParamAutomationEvent(ev.trackIndex, ev.controllerId, ev.eventKind),
  );
  if (!hasParamChange && song.automation?.length) {
    collected.push(...trakEventsFromAutomationLanes(song.automation));
  }

  return collected;
}

/**
 * Build per-track TRAK event lists for IFF TRKL export.
 * Prefers preserved trakEvents (accurate round-trip); falls back to songStructure
 * plus trakParamEvents / automation lanes for knob moves.
 */
export function buildSongModeTrakTracks(
  song: HyphonSong,
): Array<{ events: TrakWireEvent[] }> {
  const arrangement = song.songArrangement;
  if (!arrangement) return emptyTrakTracks();

  const preserved = arrangement.trakEvents ?? [];
  if (preserved.length > 0) {
    return groupEventsByTrack(preserved);
  }

  return groupEventsByTrack(synthesizeArrangementEvents(song));
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
