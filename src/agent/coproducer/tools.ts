/**
 * The co-producer's tools: definitions for the Messages API and their `run`
 * handlers, with no SDK involved. The agent loop (P2) hands `COPRODUCER_TOOLS`
 * to `betaTool()` and calls `runCoproducerTool` from each `run`; the agent hook
 * (`window.__HYPHON_AGENT__.coproducer`) calls it directly.
 *
 * Every input is validated here against the tool's full schema by a
 * precompiled validator (inputs stream eagerly, so the API does not), then by
 * the handler's own checks. Nothing throws: a bad input or a failed handler is
 * an `isError` result the model can read and correct. Every mutating tool
 * commits one undo step labelled `Co-producer: …` and answers with a compact
 * diff (`songDiff.ts`) rather than the song.
 */

import type { SavedSongData } from '../../types';
import { exportAISong, slotPatternId } from '../../importers/ai-song/exportAISong';
import { AI_TRACK_TO_TRACK_KEY } from '../../importers/ai-song/songBlock';
import { resolveSynthLaneAutomation, type OfflineAutomationSkip } from '../../audio/offline/offlineLaneAutomation';
import { MACRO_AUTOMATION_TARGETS, macroEngineForWaveform, resolveMacroParams } from '../../engines/MacroParams';
import { convertAgentSong } from '../agentSong';
import * as validators from './generated/toolValidators.js';
import type { CompiledToolValidator, ToolValidationError } from './generated/toolValidators.js';
import type { CoproducerExportFormat, CoproducerHost } from './host';
import { BASS2_FIELD, COPRODUCER_TRACKS, LANE_PARAMETERS, isMacroKnob, knobsFor, type CoproducerTrack } from './knobs';
import { measureRender } from './measure';
import { TRACK_NAME, diffSongs, songModeRows, type SongChange } from './songDiff';
import {
    arrange,
    editPattern,
    setParams,
    songArrangement,
    songSteps,
    type ArrangeInput,
    type EditPatternInput,
    type EditResult,
    type SetParamsInput,
} from './songEdits';
import {
    COPRODUCER_TOOL_NAMES,
    TOOL_INPUT_SCHEMAS,
    toStrictApiSchema,
    type CoproducerToolName,
    type JsonSchema,
} from './toolSchemas';

/** A tool definition as the Messages API takes it. */
export interface CoproducerToolDefinition {
    name: CoproducerToolName;
    description: string;
    input_schema: JsonSchema;
    strict: boolean;
    eager_input_streaming: true;
}

/** What `run` hands back: the `tool_result` content and whether it is an error. */
export interface CoproducerToolResult {
    content: string;
    isError: boolean;
}

const laneList = (['synthA', 'synthB', 'bass2'] as const)
    .map((t) => `${t}: ${LANE_PARAMETERS[t].join(', ')}`).join('; ');

const DESCRIPTIONS: Readonly<Record<CoproducerToolName, string>> = {
    get_song:
        'Read the song open in Hyphon. Returns `song` (AISongData v1.1 JSON, the format import_song takes), `knobs` '
        + '(every track\'s current knob values, in the units set_params takes), `activeSlots`, `arrangement` (its clips, when '
        + 'it has any) and `notExported` (what the song has that the format cannot show, e.g. note FX, chords, drum '
        + 'velocities — leave those alone unless asked). Patterns are named after their slot: pattern "slot3" is slot 3 '
        + 'of every track that plays it, the slot edit_pattern, set_params and arrange address. Read the song before '
        + 'editing it.',
    import_song:
        'Replace the whole open song with an AI song (AISongData v1.0 or v1.1, the schema below). Use it for a new '
        + 'song or a rewrite of most of one; for targeted changes use edit_pattern, set_params or arrange. Strict: any '
        + 'importer warning (a note past the pattern end, a lane that never plays, a pattern no measure plays) rejects '
        + 'the song and nothing changes. Returns the import report and the lanes the offline render cannot play. One '
        + 'undo step.',
    edit_pattern:
        'Edit the notes of one track\'s pattern slot, step by step: set, update or clear. Steps are 0-based and below '
        + 'the song\'s stepCount. synthA, synthB and bass2 take note names with velocity, length, accent and slide; '
        + 'the sampler takes notes too and needs a bank; drum tracks (kick, snare, closedHat, openHat) are hits with a '
        + 'velocity. Prefer this over import_song for small changes. Returns the steps that changed. One undo step.',
    set_params:
        'Turn knobs and draw automation on one track. Knob values use the units get_song.knobs shows (e.g. '
        + 'filterCutoff in Hz); a value outside the knob\'s range is refused. Automation lanes give one value per pattern '
        + 'step (0–127, null holds the previous value) and repeat every measure; a lane replaces any lane already on '
        + `that parameter. Only lanes the live engine plays are accepted — ${laneList}; drums and the sampler have none. `
        + 'Also sets the song\'s tempo and swing (no track needed). One undo step.',
    arrange:
        'Change which pattern slot each track plays when (Song Mode / the arrangement): place a slot on a range of '
        + 'measures, clear measures, trim or remove a clip (ids in get_song.arrangement), or set the song length. '
        + 'Measures are 0-based; one measure is the song\'s stepCount steps. Returns the measures whose rows changed. '
        + 'One undo step for all ops.',
    render_and_measure:
        'Render the song offline the way the export does (the arrangement, through the live master chain) and measure '
        + 'it: integrated LUFS, true peak, crest factor, RMS and spectral centroid of the master and every stem, tracks '
        + 'the mix silences, engines running on a fallback, and the automation lanes the render plays or cannot. Use it '
        + 'to check a change by numbers instead of guessing. Takes a few seconds.',
    export:
        'Build a file of the song and offer it to the user to download: rbs (ReBirth), mid (Standard MIDI), xm '
        + '(tracker module) or wav (the master render). Returns the file name, its size and any export warnings.',
};

const MUTATES: ReadonlySet<CoproducerToolName> = new Set(['import_song', 'edit_pattern', 'set_params', 'arrange']);

/** `import_song` takes the AI song schema, whose open-keyed `patterns` strict tool use cannot express. */
const NOT_STRICT: ReadonlySet<CoproducerToolName> = new Set(['import_song']);

/** The tool definitions, in a fixed order (they head the prompt cache). */
export const COPRODUCER_TOOLS: readonly CoproducerToolDefinition[] = COPRODUCER_TOOL_NAMES.map((name) => ({
    name,
    description: DESCRIPTIONS[name],
    input_schema: NOT_STRICT.has(name) ? TOOL_INPUT_SCHEMAS[name] : toStrictApiSchema(TOOL_INPUT_SCHEMAS[name]),
    strict: !NOT_STRICT.has(name),
    eager_input_streaming: true,
}));

export const isMutatingTool = (name: string): boolean => MUTATES.has(name as CoproducerToolName);

const VALIDATORS: Readonly<Record<CoproducerToolName, CompiledToolValidator>> = {
    get_song: validators.validate_get_song,
    import_song: validators.validate_import_song,
    edit_pattern: validators.validate_edit_pattern,
    set_params: validators.validate_set_params,
    arrange: validators.validate_arrange,
    render_and_measure: validators.validate_render_and_measure,
    export: validators.validate_export,
};

const ok = (value: unknown): CoproducerToolResult => ({ content: JSON.stringify(value), isError: false });
const error = (message: string, extra: Record<string, unknown> = {}): CoproducerToolResult =>
    ({ content: JSON.stringify({ error: message, ...extra }), isError: true });

/** `/edits/0/note` → `edits[0].note`. */
function errorPath(instancePath: string): string {
    if (!instancePath) return 'input';
    return instancePath.slice(1).split('/').reduce((path, part) =>
        (/^\d+$/.test(part) ? `${path}[${part}]` : path ? `${path}.${part}` : part), '');
}

export function describeValidationError(e: ToolValidationError): string {
    const params = e.params as { allowedValues?: unknown[]; additionalProperty?: string; missingProperty?: string };
    if (params.additionalProperty) return `${errorPath(e.instancePath)}: unknown field "${params.additionalProperty}"`;
    if (params.allowedValues) return `${errorPath(e.instancePath)} must be one of: ${params.allowedValues.join(', ')}`;
    return `${errorPath(e.instancePath)} ${e.message ?? `fails ${e.keyword}`}`;
}

// ---------------------------------------------------------------------------
// get_song
// ---------------------------------------------------------------------------

/** One track's knobs as `set_params` names them, with their current values. */
function knobValues(song: SavedSongData, track: CoproducerTrack, bank = 0): Record<string, unknown> {
    const params = (track === 'sampler' ? song.params.sampler?.[bank] : song.params[track]) as unknown as Record<string, unknown> | undefined;
    if (!params) return {};
    const waveform = typeof params.waveform === 'string' ? params.waveform : undefined;
    const macro = (track === 'synthA' || track === 'synthB') && !!macroEngineForWaveform(waveform ?? '');
    const resolvedMacro = macro ? resolveMacroParams(params.macro as Parameters<typeof resolveMacroParams>[0]) : null;
    const out: Record<string, unknown> = waveform !== undefined && (track === 'synthA' || track === 'synthB' || track === 'bass2') ? { waveform } : {};
    for (const name of Object.keys(knobsFor(track, macro))) {
        const value = isMacroKnob(name) && resolvedMacro
            ? resolvedMacro[MACRO_AUTOMATION_TARGETS[name].field]
            : params[track === 'bass2' ? BASS2_FIELD[name] ?? name : name];
        if (value !== undefined) out[name] = value;
    }
    return out;
}

function getSong(host: CoproducerHost): CoproducerToolResult {
    const song = host.getSong();
    const { song: aiSong, losses } = exportAISong(song, { meta: { title: 'Open song', createdAt: '1970-01-01T00:00:00Z' } });
    const knobs: Record<string, unknown> = {};
    for (const track of COPRODUCER_TRACKS) {
        knobs[track] = track === 'sampler'
            ? Array.from({ length: 8 }, (_, bank) => ({ bank, ...knobValues(song, 'sampler', bank) }))
            : knobValues(song, track);
    }
    const activeSlots = Object.fromEntries(COPRODUCER_TRACKS.map((t) => [t, song.activeTrackSlots?.[AI_TRACK_TO_TRACK_KEY[t]] ?? 0]));
    const arrangementView = songArrangement(song);
    const clips = arrangementView.clips.map((c) => ({
        id: c.id,
        track: TRACK_NAME[c.track],
        pattern: slotPatternId(c.patternSlot),
        startStep: c.startStep,
        lengthSteps: c.lengthSteps,
        loop: c.loop,
        ...(c.offsetSteps ? { offsetSteps: c.offsetSteps } : {}),
    }));
    return ok({
        song: aiSong,
        knobs,
        activeSlots,
        ...(clips.length > 0 ? { arrangement: { lengthSteps: arrangementView.lengthSteps, clips } } : {}),
        notExported: losses.map((l) => `${l.where}: ${l.message}`),
    });
}

// ---------------------------------------------------------------------------
// import_song
// ---------------------------------------------------------------------------

/** Routed lanes of `song` the stem render cannot play (`resolveSynthLaneAutomation`). */
export function unrenderedLanes(song: SavedSongData): OfflineAutomationSkip[] {
    const steps = songSteps(song);
    const rows = songModeRows(song);
    const songMode = rows.length > 0;
    return resolveSynthLaneAutomation(
        song.automationLanes ?? [],
        {
            totalSteps: Math.max(1, rows.length) * steps,
            stepCount: steps,
            songMode,
            arrangement: songMode ? songArrangement(song) : undefined,
        },
        (['synthA', 'synthB', 'bass2'] as const).map((target) => ({ target, waveform: song.params[target]?.waveform ?? '' })),
    ).report.notRendered;
}

async function importSong(input: unknown, host: CoproducerHost): Promise<CoproducerToolResult> {
    const { song, report } = convertAgentSong(input as object, { strict: true });
    if (!song) return error('the song was not imported; nothing changed', { errors: report.errors, warnings: report.warnings });
    const lanes = unrenderedLanes(song);
    await host.load(song, `Co-producer: import_song "${report.title ?? 'untitled'}"`);
    return ok({
        imported: report.title,
        tracksConverted: report.tracksConverted,
        notesConverted: report.notesConverted,
        tempo: report.tempo,
        stepCount: report.stepCount,
        timeSignature: report.timeSignature,
        measures: report.measureCount,
        unrenderedLanes: lanes,
    });
}

// ---------------------------------------------------------------------------
// edits
// ---------------------------------------------------------------------------

/** The diff without empty sections. */
function compactDiff(diff: SongChange): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    if (diff.patterns.length) out.patterns = diff.patterns;
    if (diff.knobs.length) out.knobs = diff.knobs;
    const lanes = Object.fromEntries(Object.entries(diff.lanes).filter(([, v]) => v.length > 0));
    if (Object.keys(lanes).length) out.lanes = lanes;
    if (diff.measures.changed.length || diff.measures.from !== diff.measures.to) out.measures = diff.measures;
    const clips = Object.fromEntries(Object.entries(diff.clips).filter(([, v]) => v.length > 0));
    if (Object.keys(clips).length) out.clips = clips;
    if (diff.globals.length) out.globals = diff.globals;
    return out;
}

async function runEdit(host: CoproducerHost, label: string, edit: (song: SavedSongData) => EditResult): Promise<CoproducerToolResult> {
    const before = host.getSong();
    const result = edit(before);
    if (!result.ok) return error(result.error);
    const diff = diffSongs(before, result.song);
    const notes = result.notes.length ? { notes: result.notes } : {};
    if (!diff.changed) return ok({ changed: false, ...notes });
    await host.commit(result.song, label);
    return ok({ changed: true, ...compactDiff(diff), ...notes });
}

const trackLabel = (track: CoproducerTrack, slot?: number, bank?: number) =>
    `${track}${bank !== undefined ? ` bank ${bank}` : ''}${slot !== undefined ? ` slot ${slot}` : ''}`;

// ---------------------------------------------------------------------------
// dispatch
// ---------------------------------------------------------------------------

type Handler = (input: never, host: CoproducerHost) => Promise<CoproducerToolResult> | CoproducerToolResult;

const HANDLERS: Readonly<Record<CoproducerToolName, Handler>> = {
    get_song: (_input: unknown, host) => getSong(host),
    import_song: (input: unknown, host) => importSong(input, host),
    edit_pattern: (input: EditPatternInput, host) =>
        runEdit(host, `Co-producer: edit_pattern ${trackLabel(input.track, input.slot, input.bank)}`, (song) => editPattern(song, input)),
    set_params: (input: SetParamsInput, host) =>
        runEdit(host, `Co-producer: set_params ${input.track ? trackLabel(input.track, input.slot, input.bank) : 'song'}`, (song) => setParams(song, input)),
    arrange: (input: ArrangeInput, host) =>
        runEdit(host, `Co-producer: arrange (${input.ops.length} op${input.ops.length === 1 ? '' : 's'})`, (song) => arrange(song, input)),
    render_and_measure: async (input: { stems?: boolean; bars?: boolean }, host) => {
        const song = host.getSong();
        const render = await host.render({ stems: input.stems ?? true });
        return ok(measureRender(render, { tempo: song.tempo, timeSignature: song.timeSignature }, { bars: input.bars ?? false }));
    },
    export: async (input: { format: CoproducerExportFormat }, host) => {
        const file = await host.exportFile(input.format);
        if (!file.ok) return error(`export failed: ${file.error}`, { warnings: file.warnings });
        const padding = file.base64.endsWith('==') ? 2 : file.base64.endsWith('=') ? 1 : 0;
        return ok({ offered: file.filename, bytes: (file.base64.length * 3) / 4 - padding, warnings: file.warnings });
    },
};

/**
 * Run one tool call. Never throws: an unknown tool, an input that fails its
 * schema, a handler's refusal or a thrown error all come back as `isError`.
 */
export async function runCoproducerTool(name: string, input: unknown, host: CoproducerHost): Promise<CoproducerToolResult> {
    if (!(COPRODUCER_TOOL_NAMES as readonly string[]).includes(name)) {
        return error(`unknown tool "${name}"; tools: ${COPRODUCER_TOOL_NAMES.join(', ')}`);
    }
    const tool = name as CoproducerToolName;
    const validate = VALIDATORS[tool];
    if (!validate(input)) {
        return error(`invalid ${tool} input; nothing changed`, { problems: (validate.errors ?? []).map(describeValidationError) });
    }
    try {
        return await (HANDLERS[tool] as (input: unknown, host: CoproducerHost) => Promise<CoproducerToolResult> | CoproducerToolResult)(input, host);
    } catch (e) {
        return error(`${tool} failed: ${e instanceof Error ? e.message : String(e)}`);
    }
}

