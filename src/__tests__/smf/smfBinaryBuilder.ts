/**
 * Minimal hand-rolled SMF byte builder for parser unit tests.
 * Deliberately independent of SmfExporter, so parser tests don't silently
 * pass just because both sides share a bug.
 */

function varint(value: number): number[] {
  let v = value >>> 0;
  const stack = [v & 0x7f];
  v >>>= 7;
  while (v > 0) {
    stack.push((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  return stack.reverse();
}

function strBytes(s: string): number[] {
  return Array.from(s).map((c) => c.charCodeAt(0));
}

export class TrackBuilder {
  private bytes: number[] = [];

  /** Append a delta-time + raw event bytes. */
  event(delta: number, bytes: number[]): this {
    this.bytes.push(...varint(delta), ...bytes);
    return this;
  }

  noteOn(delta: number, channel: number, note: number, velocity: number): this {
    return this.event(delta, [0x90 | channel, note, velocity]);
  }

  noteOff(delta: number, channel: number, note: number, velocity = 0): this {
    return this.event(delta, [0x80 | channel, note, velocity]);
  }

  /** Note-on with velocity 0 — a note off in running-status disguise. */
  noteOnZeroVelocity(delta: number, note: number): this {
    return this.event(delta, [note, 0]);
  }

  cc(delta: number, channel: number, controller: number, value: number): this {
    return this.event(delta, [0xb0 | channel, controller, value]);
  }

  tempo(delta: number, microsecondsPerQuarter: number): this {
    const us = microsecondsPerQuarter;
    return this.event(delta, [0xff, 0x51, 0x03, (us >> 16) & 0xff, (us >> 8) & 0xff, us & 0xff]);
  }

  timeSignature(delta: number, numerator: number, denominator: number): this {
    const denomPow = Math.round(Math.log2(denominator));
    return this.event(delta, [0xff, 0x58, 0x04, numerator, denomPow, 24, 8]);
  }

  trackName(delta: number, name: string): this {
    return this.event(delta, [0xff, 0x03, name.length, ...strBytes(name)]);
  }

  sysEx(delta: number, payload: number[]): this {
    return this.event(delta, [0xf0, ...varint(payload.length), ...payload]);
  }

  /** Raw bytes, no delta prefix — for constructing intentionally malformed data. */
  raw(bytes: number[]): this {
    this.bytes.push(...bytes);
    return this;
  }

  endOfTrack(delta = 0): this {
    return this.event(delta, [0xff, 0x2f, 0x00]);
  }

  build(): number[] {
    const length = this.bytes.length;
    return ['M'.charCodeAt(0), 'T'.charCodeAt(0), 'r'.charCodeAt(0), 'k'.charCodeAt(0), (length >>> 24) & 0xff, (length >>> 16) & 0xff, (length >>> 8) & 0xff, length & 0xff, ...this.bytes];
  }
}

export function buildSmf(options: { format?: 0 | 1; ppq?: number; tracks: TrackBuilder[] }): Uint8Array {
  const format = options.format ?? (options.tracks.length > 1 ? 1 : 0);
  const ppq = options.ppq ?? 96;
  const ntrks = options.tracks.length;

  const header = [
    ...strBytes('MThd'),
    0, 0, 0, 6,
    (format >> 8) & 0xff, format & 0xff,
    (ntrks >> 8) & 0xff, ntrks & 0xff,
    (ppq >> 8) & 0xff, ppq & 0xff,
  ];

  const trackBytes = options.tracks.flatMap((t) => t.build());
  return new Uint8Array([...header, ...trackBytes]);
}
