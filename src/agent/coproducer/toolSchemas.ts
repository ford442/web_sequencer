/**
 * Input schemas of the co-producer's tools.
 *
 * Each schema here is the full contract: `run` validates every input against
 * it (inputs stream in eagerly, so the API does not), through validators that
 * `scripts/gen-coproducer-validators.ts` precompiles from these objects — the
 * runtime ships no ajv. `toStrictApiSchema` derives what the Messages API is
 * sent for a `strict: true` tool: strict tool use takes no numeric / length /
 * pattern constraints, so those move into the description and stay enforced
 * here.
 *
 * `import_song`'s input is the AI song itself, `docs/schemas/ai-song.schema.json`
 * (generated from the importer's types, so the tool cannot drift from the
 * importer). Its `patterns` is an object keyed by any pattern id, which strict
 * tool use cannot express (`additionalProperties` must be `false`), so that one
 * tool is not strict; `run` validates it like the others.
 */

import aiSongSchema from '../../../docs/schemas/ai-song.schema.json';
import { NOTE_NAME_SOURCE } from '../../utils/musicTheory';
import {
    ALL_KNOB_NAMES,
    ALL_LANE_PARAMETERS,
    COPRODUCER_TRACKS,
    SYNTH_WAVEFORMS,
} from './knobs';

export type JsonSchema = { [key: string]: unknown };

export const COPRODUCER_TOOL_NAMES = [
    'get_song', 'import_song', 'edit_pattern', 'set_params', 'arrange', 'render_and_measure', 'export',
] as const;
export type CoproducerToolName = (typeof COPRODUCER_TOOL_NAMES)[number];

const TRACK = {
    type: 'string',
    enum: [...COPRODUCER_TRACKS],
    description: 'Track, named as in get_song: synthA, synthB, bass2, kick, snare, closedHat, openHat, sampler.',
};
const SLOT = {
    type: 'integer',
    minimum: 0,
    maximum: 31,
    description: 'Pattern slot: the N of a get_song pattern id "slotN".',
};
const BANK = { type: 'integer', minimum: 0, maximum: 7, description: 'Sampler bank. Required for the sampler track, not allowed on others.' };
const MEASURE = { type: 'integer', minimum: 0, maximum: 1023 };
const MEASURES = { type: 'integer', minimum: 1, maximum: 1024 };
const INTERPOLATION = { type: 'string', enum: ['step', 'linear', 'smooth'] };

const EMPTY_INPUT: JsonSchema = { type: 'object', properties: {}, additionalProperties: false };

const EDIT_PATTERN_INPUT: JsonSchema = {
    type: 'object',
    properties: {
        track: TRACK,
        slot: SLOT,
        bank: BANK,
        clear: { type: 'boolean', description: 'Empty the pattern before applying edits (to write it from scratch).' },
        edits: {
            type: 'array',
            minItems: 0,
            maxItems: 256,
            description: 'Applied in order.',
            items: {
                type: 'object',
                properties: {
                    step: { type: 'integer', minimum: 0, maximum: 63, description: '0-based step, below the song\'s stepCount.' },
                    action: {
                        type: 'string',
                        enum: ['set', 'update', 'clear'],
                        description: 'set: place or replace the note on the step. update: change fields of the note already there. clear: remove it.',
                    },
                    note: { type: 'string', pattern: NOTE_NAME_SOURCE, description: 'Note name, e.g. C3, F#2, Bb1. Needed by set on melodic tracks and the sampler; ignored on drums.' },
                    velocity: { type: 'number', minimum: 0, maximum: 1 },
                    length: { type: 'number', minimum: 1, maximum: 64, description: 'Steps; a longer note clears the steps it covers.' },
                    accent: { type: 'boolean', description: 'Melodic tracks.' },
                    slide: { type: 'boolean', description: 'Melodic tracks: glide into the next note.' },
                },
                required: ['step', 'action'],
                additionalProperties: false,
            },
        },
    },
    required: ['track', 'slot', 'edits'],
    additionalProperties: false,
};

const KNOBS = {
    type: 'object',
    description: 'Knob values in the units get_song.knobs shows them in. Which knobs a track takes is listed in get_song.knobs.',
    properties: {
        waveform: { type: 'string', enum: [...SYNTH_WAVEFORMS], description: 'synthA / synthB: any waveform; bass2: 303-saw or 303-sqr.' },
        ...Object.fromEntries(ALL_KNOB_NAMES.map((name) => [name, { type: 'number' }])),
    },
    additionalProperties: false,
};

const SET_PARAMS_INPUT: JsonSchema = {
    type: 'object',
    properties: {
        track: TRACK,
        bank: BANK,
        slot: {
            ...SLOT,
            description: 'synthA / synthB / bass2 in a song whose patterns carry their own knobs (get_song shows params on more than one pattern): change only the knobs recalled on that slot. Omit to change the track everywhere.',
        },
        knobs: KNOBS,
        automation: {
            type: 'array',
            maxItems: 16,
            description: 'Lanes that repeat every measure; each replaces any lane already on that parameter of the track.',
            items: {
                type: 'object',
                properties: {
                    parameter: { type: 'string', enum: [...ALL_LANE_PARAMETERS] },
                    steps: {
                        type: 'array',
                        minItems: 1,
                        maxItems: 64,
                        description: 'One value per step of the pattern (the song\'s stepCount values): 0–127, or null to hold.',
                        items: { anyOf: [{ type: 'integer', minimum: 0, maximum: 127 }, { type: 'null' }] },
                    },
                    interpolation: INTERPOLATION,
                },
                required: ['parameter', 'steps'],
                additionalProperties: false,
            },
        },
        clear_automation: {
            type: 'array',
            maxItems: 32,
            items: { type: 'string', enum: [...ALL_LANE_PARAMETERS] },
            description: 'Remove the lanes on these parameters of the track.',
        },
        tempo: { type: 'number', minimum: 30, maximum: 300, description: 'Song tempo, BPM. Needs no track.' },
        swing: {
            type: 'number',
            minimum: 0,
            maximum: 75,
            description: 'Song swing, MPC percent: 50 straight, 66.7 triplet, 75 the hardest the clock plays. Needs no track.',
        },
    },
    additionalProperties: false,
};

const ARRANGE_INPUT: JsonSchema = {
    type: 'object',
    properties: {
        ops: {
            type: 'array',
            minItems: 1,
            maxItems: 128,
            description: 'Applied in order, as one undo step.',
            items: {
                type: 'object',
                properties: {
                    op: {
                        type: 'string',
                        enum: ['place', 'clear', 'trim', 'remove_clip', 'set_length'],
                        description: 'place: put track/slot on measures [start_measure, start_measure + measures), replacing what was there. clear: silence track on those measures. trim: change clip_id (start_step / length_steps / offset_steps / loop). remove_clip: delete clip_id. set_length: song loop length in measures.',
                    },
                    track: TRACK,
                    slot: SLOT,
                    start_measure: { ...MEASURE, description: '0-based measure.' },
                    measures: { ...MEASURES, description: 'Measure count (default 1).' },
                    loop: { type: 'boolean', description: 'Repeat the pattern to fill the clip (default true).' },
                    clip_id: { type: 'string', description: 'An id from get_song.arrangement.clips.' },
                    start_step: { type: 'integer', minimum: 0, maximum: 65535 },
                    length_steps: { type: 'integer', minimum: 1, maximum: 65536 },
                    offset_steps: { type: 'integer', minimum: 0, maximum: 63, description: 'Pattern step heard at the clip\'s left edge.' },
                },
                required: ['op'],
                additionalProperties: false,
            },
        },
    },
    required: ['ops'],
    additionalProperties: false,
};

const RENDER_INPUT: JsonSchema = {
    type: 'object',
    properties: {
        stems: { type: 'boolean', description: 'Measure every track as well as the master (default true).' },
        bars: { type: 'boolean', description: 'Add the master\'s level and spectral centroid per bar (default false).' },
    },
    additionalProperties: false,
};

const EXPORT_INPUT: JsonSchema = {
    type: 'object',
    properties: {
        format: { type: 'string', enum: ['rbs', 'mid', 'xm', 'wav'] },
    },
    required: ['format'],
    additionalProperties: false,
};

/** The AI song schema as a tool input: an object at the root, no `$schema` / `$id`. */
function importSongInput(): JsonSchema {
    const rest = Object.entries(aiSongSchema as JsonSchema).filter(([key]) => !['$schema', '$id', 'title'].includes(key));
    return { type: 'object', ...Object.fromEntries(rest) };
}

export const TOOL_INPUT_SCHEMAS: Readonly<Record<CoproducerToolName, JsonSchema>> = {
    get_song: EMPTY_INPUT,
    import_song: importSongInput(),
    edit_pattern: EDIT_PATTERN_INPUT,
    set_params: SET_PARAMS_INPUT,
    arrange: ARRANGE_INPUT,
    render_and_measure: RENDER_INPUT,
    export: EXPORT_INPUT,
};

/** Keywords strict tool use does not take; `run` still enforces them. */
const STRICT_UNSUPPORTED = [
    'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf',
    'minLength', 'maxLength', 'pattern', 'minItems', 'maxItems', 'uniqueItems',
    'minProperties', 'maxProperties', 'propertyNames',
] as const;

/** "0–127", "≥ 1", "2–64 items", … for the description of a stripped node. */
function constraintNote(node: JsonSchema): string | null {
    const parts: string[] = [];
    const range = (lo: unknown, hi: unknown, unit = '') => {
        if (typeof lo === 'number' && typeof hi === 'number') parts.push(`${lo}–${hi}${unit}`);
        else if (typeof lo === 'number') parts.push(`≥ ${lo}${unit}`);
        else if (typeof hi === 'number') parts.push(`≤ ${hi}${unit}`);
    };
    range(node.minimum, node.maximum);
    range(node.minItems, node.maxItems, ' items');
    range(node.minLength, node.maxLength, ' characters');
    if (typeof node.pattern === 'string') parts.push(`matches /${node.pattern}/`);
    return parts.length ? parts.join(', ') : null;
}

/**
 * The strict-tool-use view of `schema`: unsupported constraints removed (and
 * said in the description instead), `oneOf` as `anyOf`, and every object
 * closed with `additionalProperties: false`.
 */
export function toStrictApiSchema(schema: JsonSchema): JsonSchema {
    const visit = (node: unknown): unknown => {
        if (Array.isArray(node)) return node.map(visit);
        if (!node || typeof node !== 'object') return node;
        const src = node as JsonSchema;
        const out: JsonSchema = {};
        const note = constraintNote(src);
        for (const [key, value] of Object.entries(src)) {
            if ((STRICT_UNSUPPORTED as readonly string[]).includes(key)) continue;
            if (key === 'properties' || key === '$defs') {
                out[key] = Object.fromEntries(Object.entries(value as JsonSchema).map(([k, v]) => [k, visit(v)]));
                continue;
            }
            out[key === 'oneOf' ? 'anyOf' : key] = visit(value);
        }
        if (note) out.description = typeof src.description === 'string' ? `${src.description} (${note})` : note;
        if (out.type === 'object' && out.additionalProperties === undefined) out.additionalProperties = false;
        return out;
    };
    return visit(schema) as JsonSchema;
}
