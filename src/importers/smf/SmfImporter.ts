/**
 * SMF → Hyphon importer.
 *
 * Converts a `ParsedSmf` (raw ticks/channels, format-agnostic) into a
 * `HyphonSmfSong`: quantized 32-step patterns keyed by Hyphon `TrackKey`,
 * routed by channel, with an `ImportReport` describing anything that
 * couldn't be represented losslessly.
 *
 * Grid convention (see issue): one Hyphon pattern is 32 steps = **2 bars**
 * of 4/4 16th notes, i.e. `ticksPerStep = ppq / 4` and
 * `ticksPerPattern = ticksPerStep * 32`. This is not simply "1 MIDI bar =
 * 1 pattern" — it only lines up that way when the file is 4/4.
 */

import type {
  HyphonSmfSong,
  ParsedSmf,
  SmfAutomationLane,
  SmfImportOptions,
  SmfImportReport,
  SmfImportResult,
  SmfNoteEvent,
} from './types';
import { DEFAULT_SMF_CHANNEL_MAP, DEFAULT_SMF_IMPORT_OPTIONS, GM_DRUM_NOTE_MAP } from './types';
import type { Note, Pattern, PartSequence } from '../../types';
import type { TrackKey } from '../../constants/appDefaults';
import { EMPTY_PATTERN } from '../../constants/appDefaults';
import { NUM_STEPS, TRACK_KEYS } from '../../constants';
import { MAX_TRACK_PATTERN_SLOTS, createEmptyTrackStorage } from '../../utils/trackStorageUtils';
import { midiToNote } from '../../utils/musicTheory';

const DRUM_MIDI_CHANNEL = 9; // MIDI channel 10, 0-based
const MELODIC_TRACK_KEYS: TrackKey[] = ['partA', 'partB', 'bass2'];

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function emptyPartSequence(): PartSequence {
  return { steps: Array.from({ length: NUM_STEPS }, (): null => null) };
}

interface QuantizedNote {
  patternIndex: number;
  stepInPattern: number;
  note: Note;
}

function quantizeNote(ev: SmfNoteEvent, ticksPerStep: number, quantize: boolean): QuantizedNote {
  const rawStep = ev.startTick / ticksPerStep;
  const stepIndex = quantize ? Math.round(rawStep) : Math.floor(rawStep);
  const microtiming = quantize ? clampMicrotiming(rawStep - stepIndex) : 0;
  const patternIndex = Math.floor(stepIndex / NUM_STEPS);
  const stepInPattern = ((stepIndex % NUM_STEPS) + NUM_STEPS) % NUM_STEPS;

  const stepLength = Math.max(1, Math.round((ev.endTick - ev.startTick) / ticksPerStep));

  const note: Note = {
    note: midiToNote(ev.note),
    velocity: clamp01(ev.velocity / 127),
  };
  if (stepLength > 1) note.length = stepLength;
  if (microtiming !== 0) note.microtiming = microtiming;

  return { patternIndex, stepInPattern, note };
}

function clampMicrotiming(v: number): number {
  return Math.max(-0.5, Math.min(0.5, v));
}

/** Route a non-drum note's channel to a TrackKey + "lane" (0 = primary, 1+ = extra/appended section). */
function resolveMelodicRoute(
  channel: number,
  options: SmfImportOptions,
): { target: TrackKey; lane: number } {
  const explicit = options.channelMap[channel];
  if (explicit && explicit !== 'extra' && (explicit as TrackKey) !== 'sampler') {
    return { target: explicit as TrackKey, lane: 0 };
  }
  const primary = DEFAULT_SMF_CHANNEL_MAP[channel];
  if (primary && primary !== 'extra') {
    return { target: primary as TrackKey, lane: 0 };
  }
  // Extra channel: round-robin across the 3 melodic tracks, appended as its own lane
  // (extra pattern slots on that track) rather than inventing a new track.
  const roundRobinIndex = channel % MELODIC_TRACK_KEYS.length;
  return { target: MELODIC_TRACK_KEYS[roundRobinIndex], lane: 1 + Math.floor(channel / MELODIC_TRACK_KEYS.length) };
}

interface LaneBuild {
  target: TrackKey;
  lane: number;
  channel: number;
  patterns: Map<number, PartSequence>;
  patternCount: number;
}

/**
 * Convert a parsed SMF into a HyphonSmfSong + import report.
 * Never throws — a file with no notes still returns a (loud) report rather
 * than crashing.
 */
export function convertToHyphonSong(
  parsed: ParsedSmf,
  optionsIn: Partial<SmfImportOptions> = {},
): SmfImportResult {
  const options: SmfImportOptions = { ...DEFAULT_SMF_IMPORT_OPTIONS, ...optionsIn };
  const warnings: string[] = [...parsed.warnings];

  const ppq = parsed.ppq;
  const ticksPerStep = ppq / 4; // 16th-note grid
  const bpm = parsed.tempoMap[0]?.bpm ?? 120;

  const timeSig = parsed.timeSignatures[0] ?? { tick: 0, numerator: 4, denominator: 4 };
  const timeSignatureMismatch = timeSig.numerator !== 4 || timeSig.denominator !== 4;
  if (timeSignatureMismatch) {
    warnings.push(
      `Time signature ${timeSig.numerator}/${timeSig.denominator} is not 4/4 — the 32-step grid assumes 4/4 16th notes, so timing will drift from the original bars.`,
    );
  }

  const tempoChangesAfterBar1 = parsed.tempoMap.filter((t) => t.tick > ticksPerStep * NUM_STEPS).length;
  if (tempoChangesAfterBar1 > 0) {
    warnings.push(`${tempoChangesAfterBar1} tempo change(s) after the first pattern were ignored (Hyphon has a single song BPM, taken from the first Set Tempo event).`);
  }

  const channelsUsed = Array.from(new Set(parsed.notes.map((n) => n.channel))).sort((a, b) => a - b);

  // ---- Route every note into a lane keyed by (trackKey, laneIndex). ----
  const laneKey = (target: TrackKey, lane: number): string => `${target}:${lane}`;
  const lanes = new Map<string, LaneBuild>();
  let notesUnmapped = 0;
  let drumGmMisses = 0;

  const samplerPatterns = new Map<number, PartSequence>();
  let samplerPatternCount = 0;

  for (const ev of parsed.notes) {
    if (ev.channel === DRUM_MIDI_CHANNEL) {
      const drumTrack = GM_DRUM_NOTE_MAP[ev.note];
      if (!drumTrack) {
        // Unmapped GM drum note → sampler bank 0, sharing the drum-channel timeline.
        drumGmMisses += 1;
        const q = quantizeNote(ev, ticksPerStep, options.quantize);
        if (q.patternIndex >= MAX_TRACK_PATTERN_SLOTS) {
          warnings.push(`Dropped a note past pattern slot ${MAX_TRACK_PATTERN_SLOTS} on the sampler bank (channel 10, GM note ${ev.note}).`);
          continue;
        }
        let seq = samplerPatterns.get(q.patternIndex);
        if (!seq) {
          seq = emptyPartSequence();
          samplerPatterns.set(q.patternIndex, seq);
          samplerPatternCount = Math.max(samplerPatternCount, q.patternIndex + 1);
        }
        seq.steps[q.stepInPattern] = q.note;
        continue;
      }
      const key = laneKey(drumTrack, 0);
      let lane = lanes.get(key);
      if (!lane) {
        lane = { target: drumTrack, lane: 0, channel: ev.channel, patterns: new Map(), patternCount: 0 };
        lanes.set(key, lane);
      }
      const q = quantizeNote(ev, ticksPerStep, options.quantize);
      if (q.patternIndex >= MAX_TRACK_PATTERN_SLOTS) {
        warnings.push(`Dropped a note past pattern slot ${MAX_TRACK_PATTERN_SLOTS} on ${drumTrack} (channel 10).`);
        continue;
      }
      let seq = lane.patterns.get(q.patternIndex);
      if (!seq) {
        seq = emptyPartSequence();
        lane.patterns.set(q.patternIndex, seq);
        lane.patternCount = Math.max(lane.patternCount, q.patternIndex + 1);
      }
      seq.steps[q.stepInPattern] = q.note;
      continue;
    }

    const route = resolveMelodicRoute(ev.channel, options);
    const key = laneKey(route.target, route.lane);
    let lane = lanes.get(key);
    if (!lane) {
      lane = { target: route.target, lane: route.lane, channel: ev.channel, patterns: new Map(), patternCount: 0 };
      lanes.set(key, lane);
    }
    const q = quantizeNote(ev, ticksPerStep, options.quantize);
    if (q.patternIndex >= MAX_TRACK_PATTERN_SLOTS) {
      warnings.push(`Dropped a note past pattern slot ${MAX_TRACK_PATTERN_SLOTS} on ${route.target} (channel ${ev.channel + 1}).`);
      notesUnmapped += 1;
      continue;
    }
    let seq = lane.patterns.get(q.patternIndex);
    if (!seq) {
      seq = emptyPartSequence();
      lane.patterns.set(q.patternIndex, seq);
      lane.patternCount = Math.max(lane.patternCount, q.patternIndex + 1);
    }
    if (seq.steps[q.stepInPattern] != null) {
      // Two notes landed on the same step (chord, or quantize collision) — stack as a chord.
      const existing = seq.steps[q.stepInPattern] as Note;
      existing.chord = [...(existing.chord ?? [existing.note]), q.note.note];
    } else {
      seq.steps[q.stepInPattern] = q.note;
    }
  }

  // ---- Assemble trackStorage + songStructure from lanes. ----
  const trackStorage = createEmptyTrackStorage(MAX_TRACK_PATTERN_SLOTS);

  // Primary lanes (lane 0) share one timeline; extra lanes are appended as additional
  // sequential measures on their target track (their own section, not overlapped).
  const primaryLaneEntries = Array.from(lanes.values()).filter((l) => l.lane === 0);
  const extraLaneEntries = Array.from(lanes.values())
    .filter((l) => l.lane > 0)
    .sort((a, b) => a.lane - b.lane || a.channel - b.channel);

  let primaryPatternCount = Math.max(1, samplerPatternCount, ...primaryLaneEntries.map((l) => l.patternCount), 0);
  primaryPatternCount = Math.min(primaryPatternCount, MAX_TRACK_PATTERN_SLOTS);

  for (const lane of primaryLaneEntries) {
    for (let p = 0; p < primaryPatternCount; p++) {
      trackStorage[lane.target][p] = lane.patterns.get(p) ?? emptyPartSequence();
    }
  }
  if (samplerPatternCount > 0) {
    for (let p = 0; p < primaryPatternCount; p++) {
      const bank0 = samplerPatterns.get(p) ?? emptyPartSequence();
      trackStorage.sampler[p] = [bank0, ...Array.from({ length: 7 }, () => emptyPartSequence())];
    }
  }

  const songStructure: Array<Record<TrackKey, number | null>> = [];
  const emptyMeasure = (): Record<TrackKey, number | null> => {
    const m = {} as Record<TrackKey, number | null>;
    for (const k of TRACK_KEYS) m[k] = null;
    return m;
  };

  for (let p = 0; p < primaryPatternCount; p++) {
    const measure = emptyMeasure();
    for (const lane of primaryLaneEntries) measure[lane.target] = p;
    if (samplerPatternCount > 0) measure.sampler = p;
    songStructure.push(measure);
  }

  let patternsCreated = primaryLaneEntries.length + (samplerPatternCount > 0 ? 1 : 0);

  for (const lane of extraLaneEntries) {
    const slotBase = songStructure.length; // append as new measures, own slot range on `lane.target`
    const count = Math.min(lane.patternCount, MAX_TRACK_PATTERN_SLOTS - primaryPatternCount);
    if (count < lane.patternCount) {
      warnings.push(`Channel ${lane.channel + 1} (extra) truncated to ${count} pattern slot(s) on ${lane.target} — track storage is capped at ${MAX_TRACK_PATTERN_SLOTS} slots.`);
    }
    if (count <= 0) continue;
    warnings.push(`Channel ${lane.channel + 1} had no default track — routed to ${lane.target} as ${count} extra pattern slot(s) appended after the main song (measures ${slotBase}-${slotBase + count - 1}).`);
    for (let i = 0; i < count; i++) {
      const slot = primaryPatternCount + i;
      trackStorage[lane.target][slot] = lane.patterns.get(i) ?? emptyPartSequence();
      const measure = emptyMeasure();
      measure[lane.target] = slot;
      songStructure.push(measure);
    }
    primaryPatternCount = Math.min(MAX_TRACK_PATTERN_SLOTS, primaryPatternCount + count);
    patternsCreated += count;
  }

  const notesImported = parsed.notes.length - notesUnmapped;

  // ---- Primary pattern (slot 0) for non-song-mode load. ----
  const pattern: Pattern = {
    ...EMPTY_PATTERN,
    partA: trackStorage.partA[0] as PartSequence ?? emptyPartSequence(),
    partB: trackStorage.partB[0] as PartSequence ?? emptyPartSequence(),
    bass2: trackStorage.bass2[0] as PartSequence ?? emptyPartSequence(),
    kick: trackStorage.kick[0] as PartSequence ?? emptyPartSequence(),
    snare: trackStorage.snare[0] as PartSequence ?? emptyPartSequence(),
    closedHat: trackStorage.closedHat[0] as PartSequence ?? emptyPartSequence(),
    openHat: trackStorage.openHat[0] as PartSequence ?? emptyPartSequence(),
    sampler: (trackStorage.sampler[0] as PartSequence[] | null) ?? EMPTY_PATTERN.sampler,
  };

  // ---- CC74 → filter cutoff automation on synth tracks (pattern 0 only, v1). ----
  const automation: SmfAutomationLane[] = [];
  let automationLanesConverted = 0;
  if (options.importCC74Automation) {
    for (const lane of primaryLaneEntries) {
      if (lane.target !== 'partA' && lane.target !== 'partB' && lane.target !== 'bass2') continue;
      const cc74 = parsed.controlChanges.filter((cc) => cc.channel === lane.channel && cc.controller === 74 && cc.tick < ticksPerStep * NUM_STEPS);
      if (cc74.length === 0) continue;
      const points: [number, number][] = cc74.map((cc) => {
        const step = Math.max(0, Math.min(NUM_STEPS - 1, cc.tick / ticksPerStep));
        return [step, clamp01(cc.value / 127)];
      });
      const automationTarget = lane.target === 'partA' ? 'synthA' : lane.target === 'partB' ? 'synthB' : 'bass2';
      automation.push({
        target: automationTarget,
        parameter: lane.target === 'bass2' ? 'cutoff' : 'filterCutoff',
        name: `SMF CC74 (ch ${lane.channel + 1})`,
        points,
        interpolation: 'linear',
        originalRange: [0, 127],
      });
      automationLanesConverted += 1;
    }
    const skippedCc74Channels = new Set(
      parsed.controlChanges
        .filter((cc) => cc.controller === 74 && cc.channel !== DRUM_MIDI_CHANNEL)
        .map((cc) => cc.channel),
    );
    for (const lane of primaryLaneEntries) skippedCc74Channels.delete(lane.channel);
    if (skippedCc74Channels.size > 0) {
      warnings.push(`CC74 on channel(s) ${Array.from(skippedCc74Channels).map((c) => c + 1).join(', ')} skipped — no synth track routed to that channel.`);
    }
  }

  const song: HyphonSmfSong = {
    version: 1,
    metadata: { name: 'Imported MIDI', importedFrom: 'smf', importedAt: new Date() },
    tempo: Math.round(bpm),
    timeSignature: [timeSig.numerator, timeSig.denominator],
    pattern,
    ...(automation.length > 0 ? { automation } : {}),
    ...(songStructure.length > 1 || samplerPatternCount > 1
      ? { songArrangement: { trackStorage, songStructure } }
      : {}),
  };

  if (notesImported === 0) {
    warnings.push('No notes found in this file — check the channel routing, or the file may only contain automation/meta events.');
  }

  const report: SmfImportReport = {
    notesImported,
    notesUnmapped,
    patternsCreated,
    tracksInFile: parsed.trackCount,
    channelsUsed,
    tempoChangesAfterBar1,
    timeSignatureMismatch,
    drumGmMisses,
    automationLanesConverted,
    warnings,
    formatVersion: parsed.format,
    ppq,
    bpm: Math.round(bpm),
  };

  return { success: true, song, report };
}
