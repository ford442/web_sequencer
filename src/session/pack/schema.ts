/**
 * The JSON Schema (draft 2020-12) of a `.hyphonpack.json` file, built from the
 * app's own field tables so it cannot quietly fall behind them.
 *
 *   - `Note` and `PhonemeData` are listed field by field; a compile-time check
 *     (below) fails the build when either type gains a field this file does not
 *     know, so a new note parameter cannot be silently dropped from — or refused
 *     by — pack files.
 *   - Track keys, launch modes, quantizations, waveforms, macro models and 303
 *     voices come from the modules that own them.
 *
 * `scripts/gen-session-pack-schema.ts` writes this to
 * docs/schemas/session-pack.schema.json and compiles it to the standalone
 * validator the importer runs (the app ships no ajv). Everything here is data:
 * no keyword needs a runtime helper (`uniqueItems`, `format`, object `const`s,
 * `anyOf`/`oneOf` are deliberately unused — nullable things are
 * `type: [x, 'null']`, so an error always points at the field that is wrong).
 *
 * What a JSON Schema cannot say — clip ids unique, scenes naming clips that
 * exist, non-empty clips having a pattern, equal column lengths — lives in
 * `validate.ts`, pinned against this file by `sessionPackSchema.test.ts`.
 */

import { TRACK_KEYS } from '@/constants';
import { MACRO_MAX_POLYPHONY } from '@/engines/MacroParams';
import { TB303_MODELS } from '@/engines/TB303Models';
import type { Note, PhonemeData } from '@/types';
import { NOTE_NAME_SOURCE } from '@/utils/musicTheory';
import {
  LAUNCH_QUANTIZATIONS,
  SESSION_DOCUMENT_VERSION,
  type ClipLaunchMode,
  type FollowActionKind,
} from '../types';
import { PACK_ID_SOURCE, PACK_LIMITS, SESSION_PACK_FORMAT, SESSION_PACK_FORMAT_VERSION } from './format';
import { PACK_MACRO_RANGES, PACK_SYNTH_NUMERIC_RANGES, PACK_WAVEFORMS } from './instruments';

type Json = Record<string, unknown>;

/** Clip / scene ids: the app's `c:partA:3` / `s:0` style, plus the `:x1` suffix of extra clips. */
const ITEM_ID_SOURCE = '^[A-Za-z0-9:_.-]+$';
/** Pattern-automation parameter names (`filterCutoff`, `macroTimbre`, …). */
const PARAM_NAME_SOURCE = '^[A-Za-z][A-Za-z0-9]{0,47}$';
/**
 * Free text (names, descriptions): no control characters and no bidi
 * overrides/isolates, which can make a name display as something else.
 */
const SAFE_TEXT_SOURCE = '^[^\\u0000-\\u001f\\u007f-\\u009f\\u202a-\\u202e\\u2066-\\u2069]*$';

// ── field tables ────────────────────────────────────────────────────────────

/** One entry per member of the unions: a launch mode or follow action added to the app fails to compile until it is listed here. */
const LAUNCH_MODE_SET: Record<ClipLaunchMode, true> = { trigger: true, gate: true, toggle: true, 'one-shot': true };
const FOLLOW_ACTION_SET: Record<FollowActionKind, true> = { none: true, next: true, previous: true, random: true, stop: true, repeat: true };
const LAUNCH_MODES = Object.keys(LAUNCH_MODE_SET);
const FOLLOW_ACTIONS = Object.keys(FOLLOW_ACTION_SET);

type NoteFieldKind = 'number' | 'boolean' | 'curve' | 'special';
const [N, B, C, X]: NoteFieldKind[] = ['number', 'boolean', 'curve', 'special'];

/**
 * How each `Note` field is described. The type is `Record<keyof Note, …>`, so the build fails when `Note`
 * gains a field that is not listed: it cannot be silently refused by — or dropped from — pack files.
 */
const NOTE_FIELD_KINDS: Record<keyof Note, NoteFieldKind> = {
  // own shapes: names, the chord list, two enums and the phoneme edits
  note: X, velocity: X, chord: X, slideType: X, reverbType: X, phonemes: X,
  // switches
  slide: B, slideFormant: B, isHarmonyVoice: B, reverse: B, dynamicChops: B,
  formantLfoSync: B, freezeLfoSync: B, formantEnvSync: B,
  // custom curves
  customLfoShape: C, customWindowShape: C, customGrainEnvelope: C,
  // plain numbers (sanity bounds, or the ranges in NOTE_RANGES)
  pan: N, length: N, slideFromMidi: N, slideFromFormant: N, characterMorph: N, timbre: N, probability: N,
  microtiming: N, retrigger: N, glitchChance: N, sliceIndex: N, freeze: N, formantShift: N, formantPitchLink: N,
  coarseTune: N, fineTune: N, formantLfoRate: N, formantLfoDepth: N, freezeLfoRate: N, freezeLfoDepth: N,
  freezeEnvDepth: N, timeStretchEnvDepth: N, grainPitchEnvDepth: N, grainJitter: N, grainPitchQuantize: N,
  grainEnvDepth: N, grainLfoRate: N, grainLfoDepth: N, grainPosLfoDepth: N, timeSmear: N, grainPanSpread: N,
  volumeFilterMod: N, vibratoDepth: N, reverbSend: N, reverbLfoRate: N, reverbLfoDepth: N, bitcrush: N,
  spectralComp: N, downsample: N, phonemeFilterMod: N, delayLfoRate: N, delayLfoDepth: N, delaySend: N,
  granularPitchShift: N, windowShape: N, choir: N, drive: N, tranceGate: N, subHarmonics: N, vocalChorus: N,
  vocoder: N, phonemeDelayAmount: N, phonemeDelayFeedback: N, transientExtraction: N, consonantClarity: N,
  consonantSaturation: N, autoTune: N, microtonalVariance: N, drumDuckDepth: N, formantEnvAttack: N,
  formantEnvDecay: N, formantEnvAmount: N, formantEnvFollower: N, formantSidechainDepth: N, envMod: N,
  filterCutoff: N, filterResonance: N, gateRate: N, gateDepth: N, spectralPanRate: N, spectralPanDepth: N,
  vocoderMix: N, vocoderFormantShift: N, vocoderPreservation: N, vocoderAttack: N, vocoderRelease: N,
  tremoloDepth: N, tremoloRate: N, breathIntensity: N, pitchAttack: N, pitchDecay: N, pitchAmount: N, vowel: N,
  portamento: N, spatialRouting: N,
};
const noteFieldsOfKind = (kind: NoteFieldKind) =>
  (Object.keys(NOTE_FIELD_KINDS) as Array<keyof Note>).filter((key) => NOTE_FIELD_KINDS[key] === kind);
const ALL_NOTE_FIELDS: readonly string[] = Object.keys(NOTE_FIELD_KINDS);

/** Tighter-than-default bounds for note fields whose range is fixed. */
const NOTE_RANGES: Partial<Record<keyof Note, [number, number]>> = {
  pan: [-1, 1],
  length: [0, 256],
  probability: [0, 1],
  microtiming: [-2, 2],
  retrigger: [0, 64],
  glitchChance: [0, 1],
  sliceIndex: [-1, 1023],
};

/** Same exhaustiveness guarantee for the phoneme edits a note can carry. */
const PHONEME_FIELD_KINDS: Record<keyof PhonemeData, 'text' | 'required' | 'optional'> = {
  id: 'text', symbol: 'text', start: 'required', end: 'required', pitchBend: 'required',
  vibratoDepth: 'optional', vibratoRate: 'optional', volume: 'optional', grainJitter: 'optional',
  formantShift: 'optional', grainSize: 'optional', elasticity: 'optional',
};

// ── builders ────────────────────────────────────────────────────────────────

/**
 * Number ranges are shared definitions (`Number_0_1`, `Number_20_20000`, …), one per distinct range, so the
 * shipped validator checks each range in one function and fields call it by reference instead of each
 * carrying its own copy of the check.
 */
const rangeDefs = new Map<string, Json>();
const rangeName = (n: number) => String(n).replace('-', 'n').replace('.', 'p');
const num = (min: number, max: number): Json => {
  const name = `Number_${rangeName(min)}_${rangeName(max)}`;
  if (!rangeDefs.has(name)) rangeDefs.set(name, { type: 'number', minimum: min, maximum: max });
  return ref(name);
};
const SANITY_MIN = -1e6;
const SANITY_MAX = 1e6;
const bool = (): Json => ({ type: 'boolean' });
const text = (min: number, max: number): Json => ({ type: 'string', minLength: min, maxLength: max, pattern: SAFE_TEXT_SOURCE });
const noteName = (): Json => ({ type: 'string', pattern: NOTE_NAME_SOURCE });
const ref = (name: string): Json => ({ $ref: `#/$defs/${name}` });
const closed = (properties: Json, required: string[] = []): Json => ({
  type: 'object',
  properties,
  ...(required.length > 0 ? { required } : {}),
  additionalProperties: false,
});
const nullable = (schema: Json): Json => ({ ...schema, type: [schema.type as string, 'null'] });

function phonemeSchema(): Json {
  const properties: Json = { id: text(1, 64), symbol: text(1, 16) };
  const required = ['id', 'symbol'];
  for (const [key, kind] of Object.entries(PHONEME_FIELD_KINDS)) {
    if (kind === 'text') continue;
    properties[key] = num(SANITY_MIN, SANITY_MAX);
    if (kind === 'required') required.push(key);
  }
  return closed(properties, required);
}

function stepSchema(): Json {
  const properties: Json = {
    note: noteName(),
    velocity: num(0, 1),
    chord: { type: 'array', maxItems: PACK_LIMITS.maxChordNotes, items: noteName() },
    slideType: { enum: ['linear', 'exponential'] },
    reverbType: { enum: ['room', 'plate', 'hall'] },
    phonemes: { type: 'array', maxItems: PACK_LIMITS.maxPhonemes, items: ref('Phoneme') },
  };
  for (const key of noteFieldsOfKind('boolean')) properties[key] = bool();
  for (const key of noteFieldsOfKind('curve')) {
    properties[key] = { type: 'array', maxItems: PACK_LIMITS.maxCurvePoints, items: num(SANITY_MIN, SANITY_MAX) };
  }
  for (const [key, [min, max]] of Object.entries(NOTE_RANGES)) properties[key] = num(min, max);
  // The ~80 remaining fields are all plain numbers: `propertyNames` fixes the set of names and
  // `additionalProperties` types the ones not listed above. Listing each would copy the same
  // check 80 times into the shipped validator for no change in what it accepts.
  return nullable({
    type: 'object',
    properties,
    required: ['note', 'velocity'],
    propertyNames: { enum: [...ALL_NOTE_FIELDS] },
    additionalProperties: num(SANITY_MIN, SANITY_MAX),
    description:
      'One step: a note, or null for an empty step. Fields other than note, velocity, chord, ' +
      'slideType, reverbType, phonemes, the booleans and curves (and the ranged numbers pan, length, ' +
      'probability, microtiming, retrigger, glitchChance, sliceIndex) are numbers within ±1e6.',
  });
}

function patternSchema(orNull: boolean): Json {
  const schema = closed(
    {
      steps: { type: 'array', minItems: 1, maxItems: PACK_LIMITS.maxSteps, items: ref('Step') },
      automation: {
        type: 'object',
        maxProperties: PACK_LIMITS.maxAutomationLanes,
        propertyNames: { pattern: PARAM_NAME_SOURCE, not: { enum: ['__proto__', 'constructor', 'prototype'] } },
        additionalProperties: {
          type: 'array',
          maxItems: PACK_LIMITS.maxSteps,
          items: { type: ['number', 'null'], minimum: SANITY_MIN, maximum: SANITY_MAX },
        },
      },
    },
    ['steps'],
  );
  return orNull ? nullable(schema) : schema;
}

function trackStorageSchema(): Json {
  const properties: Json = {};
  for (const track of TRACK_KEYS) {
    properties[track] = {
      type: 'array',
      maxItems: PACK_LIMITS.maxSlotsPerTrack,
      items: ref(track === 'sampler' ? 'SamplerSlot' : 'PatternSlot'),
    };
  }
  return {
    ...closed(properties),
    description:
      'Pattern slots per track, index = slot number (0-based). null / missing = empty slot. ' +
      'The sampler holds banks: each slot is an array of up to 8 patterns, one per bank.',
  };
}

function clipSchema(): Json {
  return closed(
    {
      id: { type: 'string', minLength: 1, maxLength: PACK_LIMITS.maxIdLength, pattern: ITEM_ID_SOURCE },
      name: text(1, PACK_LIMITS.maxNameLength),
      slotIndex: { type: 'integer', minimum: 0, maximum: PACK_LIMITS.maxSlotsPerTrack - 1 },
      launchMode: { enum: [...LAUNCH_MODES] },
      followAction: { enum: [...FOLLOW_ACTIONS] },
      followRepeatN: { type: 'integer', minimum: 1, maximum: 64 },
      empty: bool(),
    },
    ['id', 'name', 'slotIndex', 'launchMode', 'followAction', 'followRepeatN', 'empty'],
  );
}

function sessionSchema(): Json {
  const columns: Json = {};
  for (const track of TRACK_KEYS) columns[track] = ref('Column');
  const clipIds: Json = {};
  for (const track of TRACK_KEYS) {
    clipIds[track] = { type: ['string', 'null'], minLength: 1, maxLength: PACK_LIMITS.maxIdLength, pattern: ITEM_ID_SOURCE };
  }
  return closed(
    {
      schemaVersion: { const: SESSION_DOCUMENT_VERSION },
      quantization: { enum: [...LAUNCH_QUANTIZATIONS] },
      columns: closed(columns, [...TRACK_KEYS]),
      scenes: {
        type: 'array',
        maxItems: PACK_LIMITS.maxRows,
        items: closed(
          {
            id: { type: 'string', minLength: 1, maxLength: PACK_LIMITS.maxIdLength, pattern: ITEM_ID_SOURCE },
            name: text(1, PACK_LIMITS.maxNameLength),
            clipIds: { ...closed(clipIds), description: 'Clip id per track; null / missing = leave that track alone on scene launch.' },
          },
          ['id', 'name', 'clipIds'],
        ),
      },
    },
    ['schemaVersion', 'quantization', 'columns', 'scenes'],
  );
}

function synthSettingsSchema(): Json {
  const properties: Json = {
    waveform: { enum: [...PACK_WAVEFORMS] },
    engine303: { enum: ['open303', 'jc303'] },
    model303: { enum: TB303_MODELS.map((model) => model.id) },
    macro: closed({
      ...Object.fromEntries(Object.entries(PACK_MACRO_RANGES).map(([key, [min, max]]) => [key, num(min, max)])),
      polyphony: { type: 'integer', minimum: 1, maximum: MACRO_MAX_POLYPHONY },
      lpgMode: { enum: ['gate', 'ping'] },
    }),
  };
  for (const [key, [min, max]] of Object.entries(PACK_SYNTH_NUMERIC_RANGES)) properties[key] = num(min, max);
  return {
    ...closed(properties),
    description: 'Partial SynthParams: only these fields are accepted; omitted ones keep the part\'s current value.',
  };
}

/** The pack schema. Deterministic: same output on every call. */
export function buildSessionPackSchema(): Json {
  rangeDefs.clear();
  const schema = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://hyphon.local/schemas/session-pack.schema.json',
    title: `Hyphon session pack (${SESSION_PACK_FORMAT} v${SESSION_PACK_FORMAT_VERSION})`,
    description:
      'Generated by scripts/gen-session-pack-schema.ts from src/session/pack/schema.ts. ' +
      'Do not edit by hand; see docs/session-pack-format.md. This is the current version — ' +
      'older files are upgraded by migrateSessionPack before they are validated.',
    ...closed(
      {
        format: { const: SESSION_PACK_FORMAT },
        formatVersion: { const: SESSION_PACK_FORMAT_VERSION },
        id: {
          type: 'string',
          minLength: 1,
          maxLength: PACK_LIMITS.maxIdLength,
          pattern: PACK_ID_SOURCE,
          description: 'Stable slug. If it collides with another pack on import it is suffixed (-2, -3, …).',
        },
        name: text(1, PACK_LIMITS.maxNameLength),
        description: text(0, PACK_LIMITS.maxDescriptionLength),
        author: text(0, PACK_LIMITS.maxNameLength),
        session: { ...ref('Session'), description: 'The Session Launcher document: quantization, one column of clips per track, scenes.' },
        trackStorage: ref('TrackStorage'),
        instruments: {
          ...closed({ synthA: ref('SynthSettings'), synthB: ref('SynthSettings') }),
          description: 'SYNTH A / B settings the clips were written for; applied when the pack is loaded.',
        },
      },
      ['format', 'formatVersion', 'id', 'name', 'session', 'trackStorage'],
    ),
    $defs: {
      Session: sessionSchema(),
      Column: closed(
        {
          track: { enum: [...TRACK_KEYS] },
          clips: { type: 'array', minItems: 1, maxItems: PACK_LIMITS.maxRows, items: clipSchema() },
        },
        ['track', 'clips'],
      ),
      TrackStorage: trackStorageSchema(),
      PatternSlot: patternSchema(true),
      Pattern: patternSchema(false),
      SamplerSlot: {
        type: ['array', 'null'],
        minItems: 1,
        maxItems: PACK_LIMITS.maxSamplerBanks,
        items: ref('Pattern'),
      },
      Step: stepSchema(),
      Phoneme: phonemeSchema(),
      SynthSettings: synthSettingsSchema(),
    },
  };
  Object.assign(schema.$defs, Object.fromEntries(rangeDefs));
  return schema;
}
