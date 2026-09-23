/**
 * Hyphon → SMF exporter.
 *
 * Writes one Standard MIDI File, format 1: a conductor track (tempo + time
 * signature) plus one note track per non-empty Hyphon track. Pattern-mode
 * export writes the current 32-step pattern as one loop (2 bars of 16ths);
 * song-mode export walks the full arrangement via `resolveSongTimeline` and
 * writes the concatenated result, so the file contains every measure in
 * `SongStructure` order, not just the currently-active pattern.
 */

import type { Pattern, PartSequence, Note } from '../../types';
import type { TrackKey } from '../../constants/appDefaults';
import { resolveSongTimeline } from '../../utils/songTimeline';
import { noteToMidi } from '../../utils/musicTheory';
import { DEFAULT_PPQ } from './SmfParser';

const TICKS_PER_STEP = DEFAULT_PPQ / 4; // 16th-note grid, matches the importer's convention

const TRACK_CHANNEL: Record<Exclude<TrackKey, 'sampler'>, number> = {
  partA: 0,
  partB: 1,
  bass2: 2,
  kick: 9,
  snare: 9,
  closedHat: 9,
  openHat: 9,
};

const DRUM_GM_NOTE: Record<'kick' | 'snare' | 'closedHat' | 'openHat', number> = {
  kick: 36,
  snare: 38,
  closedHat: 42,
  openHat: 46,
};

function samplerChannel(bank: number): number {
  // Channels 0-2 are the melodic tracks, 9 is drums — skip both.
  const usable = [3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15];
  return usable[bank % usable.length];
}

export interface SmfExportInput {
  songStructure: Array<Record<TrackKey, number | null>>;
  trackStorage: Record<TrackKey, (PartSequence | PartSequence[] | null)[]>;
  currentPattern: Pattern;
  tempo: number;
}

export interface SmfExportOptions {
  useSongMode: boolean;
}

export interface SmfExportResult {
  success: boolean;
  bytes?: Uint8Array;
  blob?: Blob;
  error?: string;
  warnings: string[];
}

interface RawMidiEvent {
  tick: number;
  /** Sort priority within the same tick: note-offs before note-ons, so a retrigger doesn't overlap. */
  order: number;
  bytes: number[];
}

class ByteWriter {
  private bytes: number[] = [];

  u8(v: number): this {
    this.bytes.push(v & 0xff);
    return this;
  }
  u16(v: number): this {
    this.bytes.push((v >> 8) & 0xff, v & 0xff);
    return this;
  }
  u32(v: number): this {
    this.bytes.push((v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff);
    return this;
  }
  str(s: string): this {
    for (let i = 0; i < s.length; i++) this.bytes.push(s.charCodeAt(i) & 0xff);
    return this;
  }
  raw(bytes: number[]): this {
    this.bytes.push(...bytes);
    return this;
  }
  varint(value: number): this {
    let v = value >>> 0;
    const stack = [v & 0x7f];
    v >>>= 7;
    while (v > 0) {
      stack.push((v & 0x7f) | 0x80);
      v >>>= 7;
    }
    stack.reverse();
    this.bytes.push(...stack);
    return this;
  }
  toUint8Array(): Uint8Array {
    return new Uint8Array(this.bytes);
  }
  get length(): number {
    return this.bytes.length;
  }
}

function writeChunk(id: string, body: ByteWriter): ByteWriter {
  const out = new ByteWriter();
  out.str(id).u32(body.length).raw(Array.from(body.toUint8Array()));
  return out;
}

function noteEventsForSequence(
  steps: (Note | null)[],
  channel: number,
  gmNoteOverride?: number,
): RawMidiEvent[] {
  const events: RawMidiEvent[] = [];
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (!step) continue;
    const microtiming = step.microtiming ?? 0;
    const startTick = Math.round(i * TICKS_PER_STEP + microtiming * TICKS_PER_STEP);
    const lengthSteps = Math.max(1, step.length ?? 1);
    const endTick = startTick + Math.round(lengthSteps * TICKS_PER_STEP);
    const velocity = Math.max(1, Math.min(127, Math.round((step.velocity ?? 1) * 127)));

    const pitches = gmNoteOverride != null ? [gmNoteOverride] : (step.chord && step.chord.length > 0 ? step.chord : [step.note]).map((n) => noteToMidi(n));

    for (const midi of pitches) {
      if (midi < 0 || midi > 127) continue;
      events.push({ tick: startTick, order: 1, bytes: [0x90 | channel, midi, velocity] });
      events.push({ tick: endTick, order: 0, bytes: [0x80 | channel, midi, 0] });
    }
  }
  return events;
}

function buildNoteTrack(name: string, channel: number, events: RawMidiEvent[]): ByteWriter {
  const body = new ByteWriter();
  body.varint(0).u8(0xff).u8(0x03).varint(name.length).str(name);

  const sorted = [...events].sort((a, b) => (a.tick - b.tick) || (a.order - b.order));
  let lastTick = 0;
  for (const ev of sorted) {
    body.varint(Math.max(0, ev.tick - lastTick));
    body.raw(ev.bytes);
    lastTick = ev.tick;
  }
  body.varint(0).u8(0xff).u8(0x2f).varint(0);
  return writeChunk('MTrk', body);
}

function buildConductorTrack(bpm: number, numerator: number, denominator: number): ByteWriter {
  const body = new ByteWriter();
  const microsecondsPerQuarter = Math.round(60000000 / Math.max(1, bpm));
  body
    .varint(0).u8(0xff).u8(0x51).varint(3)
    .u8((microsecondsPerQuarter >> 16) & 0xff).u8((microsecondsPerQuarter >> 8) & 0xff).u8(microsecondsPerQuarter & 0xff);

  const denomPow = Math.round(Math.log2(Math.max(1, denominator)));
  body.varint(0).u8(0xff).u8(0x58).varint(4).u8(numerator).u8(denomPow).u8(24).u8(8);

  body.varint(0).u8(0xff).u8(0x2f).varint(0);
  return writeChunk('MTrk', body);
}

export class SmfExporter {
  exportToBytes(input: SmfExportInput, options: SmfExportOptions): SmfExportResult {
    const warnings: string[] = [];
    try {
      const timeline = options.useSongMode
        ? resolveSongTimeline(
            input.songStructure as ({ [key in TrackKey]: number | null })[],
            input.trackStorage,
            input.currentPattern,
            true,
          )
        : resolveSongTimeline([], input.trackStorage, input.currentPattern, false);

      const noteTrackChunks: ByteWriter[] = [];

      (['partA', 'partB', 'bass2'] as const).forEach((key) => {
        const seq = timeline.sequences[key];
        if (!seq.steps.some((s) => s !== null)) return;
        const events = noteEventsForSequence(seq.steps, TRACK_CHANNEL[key]);
        noteTrackChunks.push(buildNoteTrack(key, TRACK_CHANNEL[key], events));
      });

      const drumEvents: RawMidiEvent[] = [];
      (['kick', 'snare', 'closedHat', 'openHat'] as const).forEach((key) => {
        const seq = timeline.sequences[key];
        drumEvents.push(...noteEventsForSequence(seq.steps, 9, DRUM_GM_NOTE[key]));
      });
      if (drumEvents.length > 0) {
        noteTrackChunks.push(buildNoteTrack('drums', 9, drumEvents));
      }

      timeline.sequences.sampler.forEach((seq, bank) => {
        if (!seq.steps.some((s) => s !== null)) return;
        const channel = samplerChannel(bank);
        const events = noteEventsForSequence(seq.steps, channel);
        noteTrackChunks.push(buildNoteTrack(`sampler ${bank}`, channel, events));
      });

      if (noteTrackChunks.length === 0) {
        warnings.push('Nothing to export — every track is empty.');
      }

      const conductor = buildConductorTrack(input.tempo, 4, 4);
      const ntrks = 1 + noteTrackChunks.length;

      const header = new ByteWriter();
      header.u16(1).u16(ntrks).u16(DEFAULT_PPQ);
      const headerChunk = writeChunk('MThd', header);

      const out = new ByteWriter();
      out.raw(Array.from(headerChunk.toUint8Array()));
      out.raw(Array.from(conductor.toUint8Array()));
      for (const chunk of noteTrackChunks) out.raw(Array.from(chunk.toUint8Array()));

      return { success: true, bytes: out.toUint8Array(), warnings };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err), warnings };
    }
  }

  exportToBlob(input: SmfExportInput, options: SmfExportOptions): SmfExportResult {
    const result = this.exportToBytes(input, options);
    if (!result.success || !result.bytes) return result;
    return { ...result, blob: new Blob([new Uint8Array(result.bytes)], { type: 'audio/midi' }) };
  }
}

export function exportSmfFile(input: SmfExportInput, options: SmfExportOptions): SmfExportResult {
  return new SmfExporter().exportToBytes(input, options);
}

/** Thin field-pluck so callers don't need to know SmfExportInput's shape (mirrors RBS's hyphonSongFromSavedData). */
export function hyphonSongFromSavedDataForSmf(songData: {
  songStructure: unknown;
  trackStorage: unknown;
  pattern: Pattern;
  tempo: number;
}): SmfExportInput {
  return {
    songStructure: songData.songStructure as Array<Record<TrackKey, number | null>>,
    trackStorage: songData.trackStorage as Record<TrackKey, (PartSequence | PartSequence[] | null)[]>,
    currentPattern: songData.pattern,
    tempo: songData.tempo,
  };
}
