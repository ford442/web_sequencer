import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseSmfBytes, SmfParser } from '../importers/smf/SmfParser';
import { TrackBuilder, buildSmf } from './smf/smfBinaryBuilder';

describe('SmfParser', () => {
  it('rejects a file without .mid/.midi extension', () => {
    const bytes = buildSmf({ tracks: [new TrackBuilder().endOfTrack()] });
    const result = parseSmfBytes(bytes, { filename: 'song.rbs', requireExtension: true });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.type).toBe('INVALID_FORMAT');
  });

  it('rejects bytes that are not a Standard MIDI File (wrong magic)', () => {
    const bytes = new Uint8Array(32).fill(0x41);
    const result = parseSmfBytes(bytes, { filename: 'not-midi.mid' });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.type).toBe('INVALID_FORMAT');
  });

  it('rejects format 2 (independent multi-track) files', () => {
    const bytes = buildSmf({ format: 1, tracks: [new TrackBuilder().endOfTrack()] });
    // Patch format field (bytes[8..9]) to 2 after building as format 1.
    bytes[9] = 2;
    const result = parseSmfBytes(bytes, { filename: 'fmt2.mid' });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.type).toBe('UNSUPPORTED_FORMAT');
  });

  it('parses a format 0 file with a single note-on/note-off pair', () => {
    const track = new TrackBuilder()
      .noteOn(0, 0, 60, 100)
      .noteOff(48, 0, 60)
      .endOfTrack();
    const bytes = buildSmf({ format: 0, ppq: 96, tracks: [track] });

    const result = parseSmfBytes(bytes, { filename: 'single-note.mid' });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.format).toBe(0);
    expect(result.data.ppq).toBe(96);
    expect(result.data.notes).toHaveLength(1);
    expect(result.data.notes[0]).toMatchObject({ channel: 0, note: 60, velocity: 100, startTick: 0, endTick: 48 });
  });

  it('resolves running status across consecutive note-on events', () => {
    // Only the first event carries an explicit 0x90 status byte; the next two omit it.
    const track = new TrackBuilder()
      .noteOn(0, 0, 60, 100)
      .event(0, [62, 100]) // running status note-on D4
      .event(0, [64, 100]) // running status note-on E4
      .noteOff(10, 0, 60)
      .event(0, [62, 0]) // running status note-off (implicit 0x80 reused)
      .event(0, [64, 0])
      .endOfTrack();
    const bytes = buildSmf({ format: 0, ppq: 96, tracks: [track] });

    const result = parseSmfBytes(bytes, { filename: 'running-status.mid' });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.notes).toHaveLength(3);
    for (const note of result.data.notes) {
      expect(note.startTick).toBe(0);
      expect(note.endTick).toBe(10);
    }
    expect(result.data.notes.map((n) => n.note).sort()).toEqual([60, 62, 64]);
  });

  it('treats a note-on with velocity 0 as a note-off', () => {
    const track = new TrackBuilder()
      .noteOn(0, 0, 60, 100)
      .event(20, [60, 0]) // running-status note-on w/ velocity 0 == note off
      .endOfTrack();
    const bytes = buildSmf({ format: 0, ppq: 96, tracks: [track] });

    const result = parseSmfBytes(bytes, { filename: 'vel0.mid' });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.notes).toHaveLength(1);
    expect(result.data.notes[0].endTick).toBe(20);
  });

  it('extends note length while sustain (CC64) is held, ending at sustain-off', () => {
    const track = new TrackBuilder()
      .cc(0, 0, 64, 127) // sustain on
      .noteOn(0, 0, 60, 100)
      .noteOff(10, 0, 60) // released early, but sustain is held
      .cc(40, 0, 64, 0) // sustain off at tick 50
      .endOfTrack();
    const bytes = buildSmf({ format: 0, ppq: 96, tracks: [track] });

    const result = parseSmfBytes(bytes, { filename: 'sustain.mid' });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.notes).toHaveLength(1);
    expect(result.data.notes[0]).toMatchObject({ startTick: 0, endTick: 50 });
  });

  it('does not extend past sustain when the pedal is released before note-off', () => {
    const track = new TrackBuilder()
      .cc(0, 0, 64, 127)
      .noteOn(0, 0, 60, 100)
      .cc(5, 0, 64, 0) // sustain released first
      .noteOff(10, 0, 60) // then the note actually ends
      .endOfTrack();
    const bytes = buildSmf({ format: 0, ppq: 96, tracks: [track] });

    const result = parseSmfBytes(bytes, { filename: 'sustain-early-release.mid' });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.notes[0]).toMatchObject({ startTick: 0, endTick: 15 });
  });

  it('builds a tempo map from Set Tempo meta events, sorted by tick', () => {
    const track = new TrackBuilder()
      .tempo(0, 500000) // 120 BPM
      .noteOn(0, 0, 60, 100)
      .tempo(96, 400000) // 150 BPM, one beat later
      .noteOff(48, 0, 60)
      .endOfTrack();
    const bytes = buildSmf({ format: 0, ppq: 96, tracks: [track] });

    const result = parseSmfBytes(bytes, { filename: 'tempo.mid' });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.tempoMap).toHaveLength(2);
    expect(result.data.tempoMap[0]).toMatchObject({ tick: 0, bpm: 120 });
    expect(result.data.tempoMap[1]).toMatchObject({ tick: 96, bpm: 150 });
  });

  it('defaults to a single 120 BPM tempo entry when the file has no Set Tempo event', () => {
    const track = new TrackBuilder().noteOn(0, 0, 60, 100).noteOff(48, 0, 60).endOfTrack();
    const bytes = buildSmf({ format: 0, ppq: 96, tracks: [track] });

    const result = parseSmfBytes(bytes, { filename: 'no-tempo.mid' });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.tempoMap).toEqual([{ tick: 0, microsecondsPerQuarter: 500000, bpm: 120 }]);
  });

  it('parses time signature meta events', () => {
    const track = new TrackBuilder().timeSignature(0, 3, 4).endOfTrack();
    const bytes = buildSmf({ format: 0, ppq: 96, tracks: [track] });

    const result = parseSmfBytes(bytes, { filename: 'timesig.mid' });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.timeSignatures[0]).toMatchObject({ tick: 0, numerator: 3, denominator: 4 });
  });

  it('ignores SysEx payloads without corrupting subsequent parsing', () => {
    const track = new TrackBuilder()
      .sysEx(0, [0x43, 0x10, 0x4c, 0xf7])
      .noteOn(0, 0, 60, 100)
      .noteOff(48, 0, 60)
      .endOfTrack();
    const bytes = buildSmf({ format: 0, ppq: 96, tracks: [track] });

    const result = parseSmfBytes(bytes, { filename: 'sysex.mid' });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.notes).toHaveLength(1);
  });

  it('parses a format 1 multi-track file, tagging notes with their source track', () => {
    const tempoTrack = new TrackBuilder().tempo(0, 500000).endOfTrack();
    const trackA = new TrackBuilder().noteOn(0, 0, 60, 100).noteOff(48, 0, 60).endOfTrack();
    const trackB = new TrackBuilder().noteOn(0, 1, 64, 90).noteOff(48, 1, 64).endOfTrack();
    const bytes = buildSmf({ format: 1, ppq: 96, tracks: [tempoTrack, trackA, trackB] });

    const result = parseSmfBytes(bytes, { filename: 'multi-track.mid' });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.trackCount).toBe(3);
    expect(result.data.notes).toHaveLength(2);
    expect(result.data.notes.find((n) => n.channel === 0)?.trackIndex).toBe(1);
    expect(result.data.notes.find((n) => n.channel === 1)?.trackIndex).toBe(2);
  });

  it('finalizes a note with no matching note-off at end of track (truncated, not dropped)', () => {
    const track = new TrackBuilder().noteOn(0, 0, 60, 100).endOfTrack(20);
    const bytes = buildSmf({ format: 0, ppq: 96, tracks: [track] });

    const result = parseSmfBytes(bytes, { filename: 'unterminated.mid' });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.notes).toHaveLength(1);
    expect(result.data.notes[0].truncated).toBe(true);
    expect(result.data.notes[0].endTick).toBe(20);
  });

  it('never throws on a truncated/corrupted buffer (SmfParser wrapper)', async () => {
    const parser = new SmfParser();
    const garbage = new Uint8Array([0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, 0, 2, 1, 0xe0]);
    const result = await parser.parseBytes(garbage, { filename: 'garbage.mid' });
    expect(result.success).toBe(false);
  });

  it('parses the real-world fixture (test-fixtures/10_isotherms.mid) without crashing', () => {
    const midPath = resolve(process.cwd(), 'test-fixtures/10_isotherms.mid');
    if (!existsSync(midPath)) return; // fixture optional in minimal checkouts
    const bytes = readFileSync(midPath);
    const result = parseSmfBytes(new Uint8Array(bytes), { filename: '10_isotherms.mid' });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.trackCount).toBeGreaterThan(0);
  });
});
