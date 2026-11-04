/**
 * RBS file → 303 event scripts for the voice comparison harness (#1543).
 *
 * Takes the 303 patterns of a parsed ReBirth song (the pattern banks of a full
 * song, or the single legacy pattern), picks the ones the arrangement uses
 * most, and turns each into an `Voice303Script` that every backend renders.
 *
 * A pattern renders as a loop of its steps at the song tempo. Notes follow the
 * ReBirth step form that the openrb-338 voice needs (and the other voices
 * accept): a slide step is a `noteOn` while the previous note is still held,
 * and every other note gets its own `noteOff` after `gate` of a step. Rest
 * steps send nothing (the importer does not keep a rest step's note byte, so
 * openrb's `openrb303_rest` cannot be sent; see docs/audio-engine/303-voice-comparison.md).
 */

import { mapTb303PatternToSynthParams } from '../../../importers/rbs/importer/synthParams';
import type { SynthParams } from '../../../types';
import type { RawRbsData, Tb303PatternA, Tb303PatternB } from '../../../importers/rbs/types';
import { TRAK_TRACK_INDEX } from '../../../importers/rbs/types';
import { TB303_TRAK_CONTROLLER } from '../../../importers/rbs/trakControllers';
import {
  ACCENT_VELOCITY,
  NORMAL_VELOCITY,
  PARAM,
  type Voice303Event,
  type Voice303Script,
} from './script';

/**
 * How RBS knob bytes become the normalized params a voice receives.
 *
 *  - `knob`: every knob is `byte / 127`, the ReBirth panel position. Every
 *    voice gets identical control values, so differences are the DSP's. This
 *    is what the openrb-338 voice expects (it maps `v` back to `round(v * 127)`).
 *  - `import`: what the RBS importer and `Open303Manager.applyLead303Params`
 *    send a SYNTH A / SYNTH B voice today: cutoff Hz / 8000, resonance / 20,
 *    decay in seconds clamped to 0..1, env mod on the filter-mode param, and
 *    no accent or env-mod param (those stay at the voice's own default).
 */
export type ParamMapping = 'knob' | 'import';

export type RbsDevice = 'A' | 'B';

export interface RbsPatternRef {
  device: RbsDevice;
  /** Pattern slot (0..31) in the device's bank. */
  slot: number;
  /** How many TRAK pattern-select events pick this slot (0 when unknown). */
  uses: number;
  /** Notes in the pattern (steps with a pitch that are not ties). */
  notes: number;
  pattern: Tb303PatternA | Tb303PatternB;
}

const SLOT_COUNT = 32;

function noteCount(pattern: Tb303PatternA | Tb303PatternB): number {
  return pattern.steps.filter((s) => s.note >= 0 && !s.tie).length;
}

/** Pattern-select usage per slot for a 303 track (value 0..31 only; other bytes are not slots). */
function patternUsage(raw: RawRbsData, device: RbsDevice): Map<number, number> {
  const usage = new Map<number, number>();
  const trackIndex = device === 'A' ? TRAK_TRACK_INDEX.TB303_1 : TRAK_TRACK_INDEX.TB303_2;
  const track = raw.songData?.tracks.find((t) => t.trackIndex === trackIndex);
  for (const event of track?.events ?? []) {
    if (event.controllerId !== TB303_TRAK_CONTROLLER.PATTERN_SELECT) continue;
    if (event.value < 0 || event.value >= SLOT_COUNT) continue;
    usage.set(event.value, (usage.get(event.value) ?? 0) + 1);
  }
  return usage;
}

/** Every non-silent 303 pattern of the song, with its arrangement usage. */
export function listRbsPatterns(raw: RawRbsData): RbsPatternRef[] {
  const out: RbsPatternRef[] = [];
  for (const device of ['A', 'B'] as const) {
    const bank = raw.songData?.patternBanks[device === 'A' ? 'tb303A' : 'tb303B'] ?? [];
    const usage = patternUsage(raw, device);
    const patterns = bank.length > 0 ? bank : [device === 'A' ? raw.tb303PatternA : raw.tb303PatternB];
    patterns.forEach((pattern, slot) => {
      const notes = noteCount(pattern);
      if (notes > 0) out.push({ device, slot, uses: usage.get(slot) ?? 0, notes, pattern });
    });
  }
  return out;
}

/**
 * Pick up to `perDevice` patterns for each 303: most used in the arrangement
 * first, then the lowest slot. `only` (e.g. `['A0', 'B3']`) overrides the pick.
 */
export function selectRbsPatterns(
  raw: RawRbsData,
  perDevice: number,
  only?: readonly string[],
): RbsPatternRef[] {
  const all = listRbsPatterns(raw);
  if (only && only.length > 0) {
    const wanted = new Set(only.map((s) => s.toUpperCase()));
    return all.filter((p) => wanted.has(`${p.device}${p.slot}`));
  }
  const picked: RbsPatternRef[] = [];
  for (const device of ['A', 'B'] as const) {
    picked.push(
      ...all
        .filter((p) => p.device === device)
        .sort((x, y) => y.uses - x.uses || x.slot - y.slot)
        .slice(0, perDevice),
    );
  }
  return picked;
}

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

/** The normalized params a voice gets for one pattern, as `[paramId, value]` pairs. */
export function patternParams(
  pattern: Tb303PatternA | Tb303PatternB,
  mapping: ParamMapping,
  volume = 0.8,
): Array<[number, number]> {
  const waveform = pattern.waveform === 1 ? 1 : 0;
  if (mapping === 'knob') {
    return [
      [PARAM.waveform, waveform],
      [PARAM.cutoff, clamp01(pattern.cutoff / 127)],
      [PARAM.resonance, clamp01(pattern.resonance / 127)],
      [PARAM.envMod, clamp01(pattern.envMod / 127)],
      [PARAM.decay, clamp01(pattern.decay / 127)],
      [PARAM.accent, clamp01(pattern.accent / 127)],
      [PARAM.volume, volume],
      [PARAM.slideTime, 0.33],
    ];
  }
  // `import`: the importer's SynthParams, then Open303Manager.applyLead303Params.
  // asBass2 = false returns the SynthParams form.
  const synth = mapTb303PatternToSynthParams(pattern, false) as Partial<SynthParams>;
  const cutoffHz = Number(synth.filterCutoff ?? 0);
  const resonance = Number(synth.filterResonance ?? 0);
  return [
    [PARAM.waveform, waveform],
    [PARAM.cutoff, clamp01(cutoffHz / 8000)],
    [PARAM.resonance, clamp01(resonance / 20)],
    [PARAM.filterMode, clamp01(Number(synth.filterMode ?? 0))],
    [PARAM.decay, clamp01(Number(synth.decay ?? 0))],
    [PARAM.volume, Number(synth.volume ?? volume)],
  ];
}

export interface PatternScriptOptions {
  tempo: number;
  /** Times the pattern repeats. */
  loops: number;
  /** Note length as a fraction of a step before the `noteOff` (0..1]. */
  gate: number;
  sampleRate: number;
  mapping: ParamMapping;
  /** Seconds rendered after the last step, for the release tail. */
  tailSeconds: number;
}

export const DEFAULT_PATTERN_SCRIPT_OPTIONS: Omit<PatternScriptOptions, 'tempo'> = {
  loops: 4,
  gate: 0.6,
  sampleRate: 44_100,
  mapping: 'knob',
  tailSeconds: 0.75,
};

/** The MIDI note of a step: ReBirth octave 3 / note 0 is C3 = MIDI 48. */
export function stepMidiNote(step: { note: number; octave: number }): number {
  return (step.octave + 1) * 12 + step.note;
}

/** Turn one pattern into an event script (see the file header for the note form). */
export function patternToScript(
  pattern: Tb303PatternA | Tb303PatternB,
  options: PatternScriptOptions,
): Voice303Script {
  const { sampleRate, tempo, loops, gate } = options;
  const stepFrames = (sampleRate * 60) / (tempo * 4);
  const steps = pattern.steps;
  const total = steps.length * loops;
  const at = (i: number) => steps[i % steps.length];
  const frameOf = (stepPos: number) => Math.round(stepPos * stepFrames);

  const events: Voice303Event[] = patternParams(pattern, options.mapping).map(([id, value]) => ({
    frame: 0,
    kind: 'param' as const,
    id,
    value,
  }));

  for (let i = 0; i < total; i++) {
    const step = at(i);
    if (step.note < 0 || step.tie) continue;

    let length = 1;
    while (i + length < total && at(i + length).tie) length++;

    const note = stepMidiNote(step);
    events.push({
      frame: frameOf(i),
      kind: 'on',
      note,
      velocity: step.accent ? ACCENT_VELOCITY : NORMAL_VELOCITY,
    });

    const next = i + length < total ? at(i + length) : undefined;
    const slidesInto = !!next && next.note >= 0 && !next.tie && next.slide;
    if (!slidesInto) {
      events.push({ frame: frameOf(i + length - 1 + gate), kind: 'off', note });
    }
  }

  return {
    sampleRate,
    totalFrames: frameOf(total) + Math.round(options.tailSeconds * sampleRate),
    events,
  };
}
