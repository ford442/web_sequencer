import type { AutomationTarget } from '../types';

/** Identifies a mappable on-screen control (automation target + parameter id). */
export type MidiControlTarget = AutomationTarget;
export type MidiControlId = `${MidiControlTarget}:${string}`;

export function makeMidiControlId(target: MidiControlTarget, param: string): MidiControlId {
  return `${target}:${param}` as MidiControlId;
}

export function parseMidiControlId(id: MidiControlId): { target: MidiControlTarget; param: string } {
  const colon = id.indexOf(':');
  return { target: id.slice(0, colon) as MidiControlTarget, param: id.slice(colon + 1) };
}

export type MidiMessageType = 'cc' | 'note';

/** Stable key for a MIDI input message (channel + number). */
export interface MidiMessageKey {
  type: MidiMessageType;
  /** MIDI channel 0–15 */
  channel: number;
  /** CC number (0–127) or note number (0–127) */
  number: number;
}

export interface MidiBinding {
  key: MidiMessageKey;
  controlId: MidiControlId;
  /** Optional Web MIDI device id — omitted = match any device */
  deviceId?: string;
}

export function midiKeyToString(key: MidiMessageKey): string {
  return `${key.type}:${key.channel}:${key.number}`;
}

export function formatMidiBindingLabel(key: MidiMessageKey): string {
  if (key.type === 'cc') {
    return `CC${key.number + 1} · Ch ${key.channel + 1}`;
  }
  return `Note ${key.number} · Ch ${key.channel + 1}`;
}

/** Normalize raw MIDI value (0–127) to 0–1. */
export function midiValueToNormalized(raw: number): number {
  return Math.max(0, Math.min(1, raw / 127));
}
