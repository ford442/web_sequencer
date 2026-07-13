/** Parsed MIDI channel message (subset of Web MIDI 1.0). */

export type ParsedMidiMessage =
  | { type: 'noteOn'; channel: number; note: number; velocity: number }
  | { type: 'noteOff'; channel: number; note: number; velocity: number }
  | { type: 'cc'; channel: number; cc: number; value: number }
  | { type: 'programChange'; channel: number; value: number }
  | { type: 'pitchBend'; channel: number; pitchBendValue: number };

/**
 * Parse a raw MIDI message into a structured object.
 * Returns null for unsupported system-realtime / sysex messages.
 */
export function parseMidiMessage(data: Uint8Array): ParsedMidiMessage | null {
  if (data.length < 2) return null;

  const status = data[0];
  const command = status & 0xf0;
  const channel = status & 0x0f;

  if (command === 0x90) {
    const note = data[1];
    const velocity = data.length >= 3 ? data[2] : 0;
    if (velocity === 0) {
      return { type: 'noteOff', channel, note, velocity: 0 };
    }
    return { type: 'noteOn', channel, note, velocity };
  }

  if (command === 0x80) {
    const note = data[1];
    const velocity = data.length >= 3 ? data[2] : 0;
    return { type: 'noteOff', channel, note, velocity };
  }

  if (command === 0xb0 && data.length >= 3) {
    return { type: 'cc', channel, cc: data[1], value: data[2] };
  }

  if (command === 0xc0 && data.length >= 2) {
    return { type: 'programChange', channel, value: data[1] };
  }

  if (command === 0xe0 && data.length >= 3) {
    const raw = data[1] | (data[2] << 7);
    return { type: 'pitchBend', channel, pitchBendValue: raw - 8192 };
  }

  return null;
}

/** Map learnable CC / note-on messages to a stable binding key + normalized value. */
export function midiMessageToBinding(
  msg: ParsedMidiMessage,
): { key: { type: 'cc' | 'note'; channel: number; number: number }; value: number } | null {
  if (msg.type === 'cc') {
    return { key: { type: 'cc', channel: msg.channel, number: msg.cc }, value: msg.value };
  }
  if (msg.type === 'noteOn') {
    return { key: { type: 'note', channel: msg.channel, number: msg.note }, value: msg.velocity };
  }
  return null;
}
