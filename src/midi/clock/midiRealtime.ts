/** System-realtime MIDI messages for transport sync (0xF8–0xFF). */

export type MidiRealtimeMessage =
  | { type: 'clock' }
  | { type: 'start' }
  | { type: 'continue' }
  | { type: 'stop' }
  | { type: 'songPosition'; sixteenthNotes: number };

const REALTIME_MIN = 0xf8;
const REALTIME_MAX = 0xff;

export function isMidiSystemRealtime(status: number): boolean {
  return status >= REALTIME_MIN && status <= REALTIME_MAX;
}

/**
 * Parse a system-realtime or SPP message.
 * SPP (0xF2) is a system common message, not 0xF8–0xFF.
 */
export function parseMidiRealtime(data: Uint8Array): MidiRealtimeMessage | null {
  if (data.length === 0) return null;
  const status = data[0];

  switch (status) {
    case 0xf8:
      return { type: 'clock' };
    case 0xfa:
      return { type: 'start' };
    case 0xfb:
      return { type: 'continue' };
    case 0xfc:
      return { type: 'stop' };
    case 0xf2:
      if (data.length < 3) return null;
      // 14-bit value: LSB | (MSB << 7), in MIDI beats (quarter notes)
      {
        const beats = data[1] | ((data[2] & 0x7f) << 7);
        const sixteenthNotes = beats * 4;
        return { type: 'songPosition', sixteenthNotes };
      }
    default:
      if (isMidiSystemRealtime(status)) return null;
      return null;
  }
}

/** Map SPP 16th-note position to Hyphon step index. */
export function sppToStep(sixteenthNotes: number, numSteps: number): number {
  if (numSteps <= 0) return 0;
  return ((sixteenthNotes % numSteps) + numSteps) % numSteps;
}

/** Tick index within a quarter note (0–23). */
export function tickWithinQuarter(totalTicks: number): number {
  return ((totalTicks % 24) + 24) % 24;
}
