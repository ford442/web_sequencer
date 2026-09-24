/**
 * Standard MIDI File (SMF) parser.
 *
 * Reads format 0 / format 1 `.mid` files: `MThd`/`MTrk` chunks, running
 * status, note on/off (incl. velocity-0-as-note-off), sustain pedal (CC64)
 * note-length extension, tempo map, time-signature meta events, and ignores
 * SysEx. Format 2 (independent multi-track) is rejected — Hyphon has one
 * transport, not several independent ones.
 *
 * Mirrors `RbsParser`'s API shape (`parseBytes(bytes, options)`, never
 * throws, discriminated `{ success, ... }` result) so the SMF path reads
 * the same way as the RBS path elsewhere in the app.
 */

import type {
  ParsedSmf,
  SmfControlChangeEvent,
  SmfNoteEvent,
  SmfParserError,
  SmfParserResult,
  SmfProgramChangeEvent,
  SmfTempoEvent,
  SmfTimeSignatureEvent,
  SmfTrackMeta,
} from './types';

export const MIN_SMF_FILE_SIZE = 14; // MThd header (8) + minimum length field (6)
export const MAX_SMF_FILE_SIZE = 10 * 1024 * 1024;
export const DEFAULT_PPQ = 480;
const DEFAULT_MICROSECONDS_PER_QUARTER = 500000; // 120 BPM
const DEFAULT_TIME_SIGNATURE: SmfTimeSignatureEvent = { tick: 0, numerator: 4, denominator: 4 };

function microsecondsPerQuarterToBpm(us: number): number {
  if (us <= 0) return 120;
  return 60000000 / us;
}

/** Cursor over a DataView with the primitives SMF track data needs. */
class ByteReader {
  pos = 0;
  private view: DataView;
  readonly length: number;

  constructor(view: DataView, length: number) {
    this.view = view;
    this.length = length;
  }

  get eof(): boolean {
    return this.pos >= this.length;
  }

  u8(): number {
    const v = this.view.getUint8(this.pos);
    this.pos += 1;
    return v;
  }

  u16(): number {
    const v = this.view.getUint16(this.pos, false);
    this.pos += 2;
    return v;
  }

  u32(): number {
    const v = this.view.getUint32(this.pos, false);
    this.pos += 4;
    return v;
  }

  bytes(n: number): Uint8Array {
    const out = new Uint8Array(this.view.buffer, this.view.byteOffset + this.pos, n);
    this.pos += n;
    return out;
  }

  skip(n: number): void {
    this.pos += n;
  }

  string(n: number): string {
    const bytes = this.bytes(n);
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return s;
  }

  /** MIDI variable-length quantity: 7 bits per byte, MSB = continuation flag. */
  varint(): number {
    let value = 0;
    for (let i = 0; i < 5; i++) {
      const byte = this.u8();
      value = (value << 7) | (byte & 0x7f);
      if ((byte & 0x80) === 0) return value;
    }
    throw new Error('Malformed variable-length quantity (no terminating byte within 5 bytes)');
  }
}

interface ChannelSustainState {
  sustainOn: boolean;
  /** Notes still physically held (note-on received, no note-off yet). */
  active: Map<number, { startTick: number; velocity: number }>;
  /** Notes released while sustain was held — finalized when sustain lifts. */
  sustainedReleases: Map<number, { startTick: number; velocity: number }>;
}

function newChannelState(): ChannelSustainState {
  return { sustainOn: false, active: new Map(), sustainedReleases: new Map() };
}

/**
 * Parse a Standard MIDI File.
 * Never throws — all failures are returned as `{ success: false, error }`.
 */
export function parseSmfBytes(
  bytes: Uint8Array,
  options: { filename?: string; requireExtension?: boolean } = {},
): SmfParserResult {
  const filename = options.filename ?? 'input.mid';
  const requireExtension = options.requireExtension ?? true;

  try {
    if (requireExtension) {
      const lower = filename.toLowerCase();
      if (!lower.endsWith('.mid') && !lower.endsWith('.midi')) {
        return {
          success: false,
          error: { type: 'INVALID_FORMAT', message: `File "${filename}" does not have a .mid/.midi extension` },
        };
      }
    }

    if (bytes.byteLength < MIN_SMF_FILE_SIZE) {
      return {
        success: false,
        error: { type: 'CORRUPTED_DATA', section: 'header', details: `File too small (${bytes.byteLength} bytes, min ${MIN_SMF_FILE_SIZE})` },
      };
    }
    if (bytes.byteLength > MAX_SMF_FILE_SIZE) {
      return {
        success: false,
        error: { type: 'INVALID_FORMAT', message: 'File too large (max 10MB for SMF files)' },
      };
    }

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const reader = new ByteReader(view, bytes.byteLength);

    const magic = reader.string(4);
    if (magic !== 'MThd') {
      return {
        success: false,
        error: { type: 'INVALID_FORMAT', message: `Not a Standard MIDI File: expected "MThd" magic, got "${magic}"` },
      };
    }

    const headerLength = reader.u32();
    if (headerLength < 6 || reader.pos + headerLength > reader.length) {
      return {
        success: false,
        error: { type: 'CORRUPTED_DATA', section: 'MThd', details: `Invalid header chunk length (${headerLength})`, offset: reader.pos },
      };
    }

    const headerEnd = reader.pos + headerLength;
    const format = reader.u16();
    const ntrks = reader.u16();
    const division = reader.u16();
    reader.pos = headerEnd; // skip any header padding beyond the 6 documented bytes

    if (format !== 0 && format !== 1 && format !== 2) {
      return { success: false, error: { type: 'UNSUPPORTED_FORMAT', format } };
    }
    if (format === 2) {
      return { success: false, error: { type: 'UNSUPPORTED_FORMAT', format: 2 } };
    }

    if ((division & 0x8000) !== 0) {
      // SMPTE (frames/ticks) division — not a ticks-per-quarter-note grid.
      return {
        success: false,
        error: { type: 'CORRUPTED_DATA', section: 'MThd', details: 'SMPTE time division is not supported (only ticks-per-quarter-note files)' },
      };
    }
    const ppq = division === 0 ? DEFAULT_PPQ : division;

    const warnings: string[] = [];
    const tracks: SmfTrackMeta[] = [];
    const notes: SmfNoteEvent[] = [];
    const controlChanges: SmfControlChangeEvent[] = [];
    const programChanges: SmfProgramChangeEvent[] = [];
    const tempoMap: SmfTempoEvent[] = [];
    const timeSignatures: SmfTimeSignatureEvent[] = [];
    let totalTicks = 0;
    let trackIndex = 0;

    while (!reader.eof && trackIndex < ntrks) {
      if (reader.pos + 8 > reader.length) {
        warnings.push(`Truncated file: expected ${ntrks} tracks, only found ${trackIndex}`);
        break;
      }
      const chunkId = reader.string(4);
      const chunkLength = reader.u32();
      const chunkStart = reader.pos;
      const chunkEnd = chunkStart + chunkLength;

      if (chunkEnd > reader.length) {
        return {
          success: false,
          error: { type: 'CORRUPTED_DATA', section: `MTrk[${trackIndex}]`, details: 'Track chunk length runs past end of file', offset: chunkStart },
        };
      }

      if (chunkId !== 'MTrk') {
        // Unknown/vendor chunk — skip it (not a track).
        reader.pos = chunkEnd;
        continue;
      }

      const trackMeta: SmfTrackMeta = { index: trackIndex, endTick: 0 };
      const channelStates: ChannelSustainState[] = Array.from({ length: 16 }, () => newChannelState());
      let tick = 0;
      let runningStatus = 0;
      let trackEnded = false;

      const finalizeNote = (channel: number, note: number, startTick: number, velocity: number, endTick: number): void => {
        notes.push({ trackIndex, channel, note, velocity, startTick, endTick: Math.max(endTick, startTick) });
      };

      const noteOn = (channel: number, note: number, velocity: number, atTick: number): void => {
        const state = channelStates[channel];
        const existing = state.active.get(note);
        if (existing) {
          // Retrigger without a note-off: close the previous instance here.
          finalizeNote(channel, note, existing.startTick, existing.velocity, atTick);
          state.active.delete(note);
        }
        state.sustainedReleases.delete(note);
        state.active.set(note, { startTick: atTick, velocity });
      };

      const noteOff = (channel: number, note: number, atTick: number): void => {
        const state = channelStates[channel];
        const existing = state.active.get(note);
        if (!existing) return; // stray note-off, ignore
        state.active.delete(note);
        if (state.sustainOn) {
          state.sustainedReleases.set(note, existing);
        } else {
          finalizeNote(channel, note, existing.startTick, existing.velocity, atTick);
        }
      };

      const controlChange = (channel: number, controller: number, value: number, atTick: number): void => {
        controlChanges.push({ trackIndex, channel, controller, value, tick: atTick });
        if (controller !== 64) return; // sustain pedal only
        const state = channelStates[channel];
        const nowOn = value >= 64;
        if (nowOn && !state.sustainOn) {
          state.sustainOn = true;
        } else if (!nowOn && state.sustainOn) {
          state.sustainOn = false;
          for (const [note, held] of state.sustainedReleases) {
            finalizeNote(channel, note, held.startTick, held.velocity, atTick);
          }
          state.sustainedReleases.clear();
        }
      };

      while (reader.pos < chunkEnd && !trackEnded) {
        const delta = reader.varint();
        tick += delta;

        let statusByte = reader.u8();
        if (statusByte < 0x80) {
          // Running status: this byte is actually the first data byte.
          if (runningStatus === 0) {
            return {
              success: false,
              error: { type: 'CORRUPTED_DATA', section: `MTrk[${trackIndex}]`, details: 'Data byte encountered with no prior status byte (invalid running status)', offset: reader.pos - 1 },
            };
          }
          reader.pos -= 1;
          statusByte = runningStatus;
        } else if (statusByte < 0xf0) {
          runningStatus = statusByte;
        }

        if (statusByte === 0xff) {
          // Meta event.
          runningStatus = 0;
          const metaType = reader.u8();
          const len = reader.varint();
          const dataStart = reader.pos;
          switch (metaType) {
            case 0x51: {
              // Set Tempo: 3-byte microseconds-per-quarter-note.
              const us = (reader.u8() << 16) | (reader.u8() << 8) | reader.u8();
              tempoMap.push({ tick, microsecondsPerQuarter: us, bpm: microsecondsPerQuarterToBpm(us) });
              break;
            }
            case 0x58: {
              // Time Signature: nn dd cc bb (dd = power-of-2 denominator).
              const numerator = reader.u8();
              const denomPow = reader.u8();
              reader.skip(2); // MIDI clocks/click, 32nds/quarter — unused
              timeSignatures.push({ tick, numerator, denominator: 2 ** denomPow });
              break;
            }
            case 0x03: {
              trackMeta.name = reader.string(len).replace(/\0/g, '');
              break;
            }
            case 0x2f: {
              trackEnded = true;
              break;
            }
            default:
              // Unknown/uninteresting meta event (lyrics, marker, etc.) — skip.
              break;
          }
          reader.pos = dataStart + len;
        } else if (statusByte === 0xf0 || statusByte === 0xf7) {
          // SysEx (or continuation) — ignore payload entirely.
          const len = reader.varint();
          reader.skip(len);
        } else if (statusByte >= 0x80 && statusByte <= 0xef) {
          const channel = statusByte & 0x0f;
          const kind = statusByte & 0xf0;
          if (kind === 0x80) {
            const note = reader.u8();
            reader.u8(); // release velocity, unused
            noteOff(channel, note, tick);
          } else if (kind === 0x90) {
            const note = reader.u8();
            const velocity = reader.u8();
            if (velocity === 0) {
              noteOff(channel, note, tick);
            } else {
              noteOn(channel, note, velocity, tick);
            }
          } else if (kind === 0xa0) {
            reader.u8();
            reader.u8(); // polyphonic key pressure — unused
          } else if (kind === 0xb0) {
            const controller = reader.u8();
            const value = reader.u8();
            controlChange(channel, controller, value, tick);
          } else if (kind === 0xc0) {
            const program = reader.u8();
            programChanges.push({ trackIndex, channel, program, tick });
          } else if (kind === 0xd0) {
            reader.u8(); // channel pressure — unused
          } else if (kind === 0xe0) {
            reader.u8();
            reader.u8(); // pitch bend — unused in v1
          }
        } else {
          return {
            success: false,
            error: { type: 'CORRUPTED_DATA', section: `MTrk[${trackIndex}]`, details: `Unexpected status byte 0x${statusByte.toString(16)}`, offset: reader.pos - 1 },
          };
        }
      }

      // Close out any notes still active (or held by sustain) at end of track.
      for (let channel = 0; channel < 16; channel++) {
        const state = channelStates[channel];
        for (const [note, held] of state.active) {
          notes.push({ trackIndex, channel, note, velocity: held.velocity, startTick: held.startTick, endTick: tick, truncated: true });
        }
        for (const [note, held] of state.sustainedReleases) {
          notes.push({ trackIndex, channel, note, velocity: held.velocity, startTick: held.startTick, endTick: tick, truncated: true });
        }
      }

      trackMeta.endTick = tick;
      tracks.push(trackMeta);
      totalTicks = Math.max(totalTicks, tick);
      reader.pos = chunkEnd; // resync even if EOT was missing/short
      trackIndex += 1;
    }

    if (tracks.length === 0) {
      return { success: false, error: { type: 'CORRUPTED_DATA', section: 'MTrk', details: 'File contains no MTrk chunks' } };
    }

    if (tempoMap.length === 0 || tempoMap[0].tick !== 0) {
      tempoMap.unshift({ tick: 0, microsecondsPerQuarter: DEFAULT_MICROSECONDS_PER_QUARTER, bpm: 120 });
    }
    tempoMap.sort((a, b) => a.tick - b.tick);

    if (timeSignatures.length === 0) {
      timeSignatures.push({ ...DEFAULT_TIME_SIGNATURE });
    }
    timeSignatures.sort((a, b) => a.tick - b.tick);

    notes.sort((a, b) => a.startTick - b.startTick);

    const data: ParsedSmf = {
      format: format as 0 | 1,
      ppq,
      trackCount: tracks.length,
      tracks,
      notes,
      controlChanges,
      programChanges,
      tempoMap,
      timeSignatures,
      totalTicks,
      warnings,
    };

    return { success: true, data };
  } catch (err) {
    return {
      success: false,
      error: { type: 'READ_ERROR', message: err instanceof Error ? err.message : String(err) },
    };
  }
}

export class SmfParser {
  onProgress?: (percent: number) => void;

  async parseBytes(
    bytes: Uint8Array,
    options: { filename?: string; requireExtension?: boolean } = {},
  ): Promise<SmfParserResult> {
    this.onProgress?.(0);
    const result = parseSmfBytes(bytes, options);
    this.onProgress?.(100);
    return result;
  }
}

export async function parseSmfFile(file: File): Promise<SmfParserResult> {
  const buffer = await file.arrayBuffer();
  return parseSmfBytes(new Uint8Array(buffer), { filename: file.name });
}
