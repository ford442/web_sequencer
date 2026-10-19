/**
 * Pure helpers behind the agent render hook (`window.__HYPHON_AGENT__`).
 *
 * The hook lets an agent import an `AISongData` song, render it and read the
 * result back without a human at the import modal (`pnpm run ai-song:render`,
 * see docs/ai-song-render.md). Everything here is DOM-free so it is unit-tested
 * on its own; the hook itself lives in `AgentBridge.tsx`.
 */

import { AISongImporter, parseAISongJSON } from '../importers/ai-song/AISongImporter';
import type { AIImportErrorDetails, AIImportReport } from '../importers/ai-song/types';
import { stockModelForFamily } from '../engines/TB303Models';
import type { SavedSongData, SynthParams, Bass2Params } from '../types';

export type AgentEngine303 = 'open303' | 'jc303';

export interface AgentImportOptions {
    /**
     * Default true: any importer warning (a dropped note, a lane that never
     * plays, a pattern the song never reaches) fails the import and nothing
     * is loaded. False loads the song and reports the warnings.
     */
    strict?: boolean;
    /** Put every 303 voice on this engine before the song loads. */
    engine303?: AgentEngine303;
}

/** What `importAISong` did. `ok` is false when nothing was loaded. */
export interface AgentImportReport {
    ok: boolean;
    strict: boolean;
    title: string | null;
    /** Validation failures, or (strict) the warnings that failed the import. */
    errors: string[];
    warnings: string[];
    tracksConverted: number;
    notesConverted: number;
    tempo: number | null;
    /** Song pattern length (`globals.stepCount`, 32 for a v1.0 song). */
    stepCount: number | null;
    timeSignature: [number, number] | null;
    /** Song Mode rows (0 for a v1.0 song, which plays its one pattern). */
    measureCount: number;
    engine303: AgentEngine303 | null;
}

/** A converted song ready to load, or the report saying why there is none. */
export type AgentConversion =
    | { song: SavedSongData; report: AgentImportReport }
    | { song: null; report: AgentImportReport };

export function describeImportError(error: AIImportErrorDetails): string {
    switch (error.type) {
        case 'VALIDATION_ERROR':
            return `${error.field}: ${error.message}`;
        case 'UNSUPPORTED_VERSION':
            return `meta.version: unsupported version "${error.version}"`;
        case 'CONVERSION_ERROR':
            return `${error.track}: ${error.details}`;
        case 'INVALID_NOTE':
            return `tracks.${error.track}: invalid note "${error.note}"`;
        case 'STORAGE_ERROR':
            return error.message;
    }
}

function emptyReport(strict: boolean, engine303: AgentEngine303 | null): AgentImportReport {
    return {
        ok: false,
        strict,
        title: null,
        errors: [],
        warnings: [],
        tracksConverted: 0,
        notesConverted: 0,
        tempo: null,
        stepCount: null,
        timeSignature: null,
        measureCount: 0,
        engine303,
    };
}

const is303Waveform = (waveform: string | undefined) => waveform === '303-saw' || waveform === '303-sqr';

/** `params` on `engine` when it plays a 303 (its own waveform, else the track's). */
function with303Engine<T extends Partial<SynthParams> | Partial<Bass2Params>>(
    params: T,
    engine: AgentEngine303,
    trackWaveform: string | undefined,
): T {
    if (!is303Waveform(params.waveform ?? trackWaveform)) return params;
    return { ...params, engine303: engine, model303: stockModelForFamily(engine) };
}

/**
 * Put every 303 voice of `song` on `engine`: each of SYNTH A / SYNTH B / BASS 2
 * that plays a 303 waveform, and their per-slot params in a v1.1 song. The
 * model is the family's stock voice (`stock-open303` / `jc303`), as the
 * oscillator family switch in the rack sets it.
 */
export function force303Engine(song: SavedSongData, engine: AgentEngine303): SavedSongData {
    const params = { ...song.params };
    const waveA = params.synthA?.waveform;
    const waveB = params.synthB?.waveform;
    const wave2 = params.bass2?.waveform;
    if (params.synthA) params.synthA = with303Engine(params.synthA, engine, waveA);
    if (params.synthB) params.synthB = with303Engine(params.synthB, engine, waveB);
    if (params.bass2) params.bass2 = with303Engine(params.bass2, engine, wave2);

    const storage = song.trackParamStorage;
    const trackParamStorage = storage && {
        synthA: storage.synthA.map((p) => (p ? with303Engine(p, engine, waveA) : p)),
        synthB: storage.synthB.map((p) => (p ? with303Engine(p, engine, waveB) : p)),
        bass2: storage.bass2.map((p) => (p ? with303Engine(p, engine, wave2) : p)),
    };
    return { ...song, params, ...(trackParamStorage ? { trackParamStorage } : {}) };
}

/**
 * Parse, validate and convert an AI song the way the import modal does, then
 * apply the agent options. Strict mode turns every importer warning into an
 * error: an agent that cannot hear the result must not get a song that
 * silently lost part of what it wrote.
 */
export function convertAgentSong(input: string | object, options: AgentImportOptions = {}): AgentConversion {
    const strict = options.strict ?? true;
    const engine303 = options.engine303 ?? null;
    const report = emptyReport(strict, engine303);

    let data: unknown = input;
    if (typeof input === 'string') {
        const parsed = parseAISongJSON(input);
        if (!parsed.success) {
            report.errors.push(parsed.error);
            return { song: null, report };
        }
        data = parsed.data;
    }

    const result = new AISongImporter().convert(data as Parameters<AISongImporter['convert']>[0]);
    if (!result.success) {
        report.errors.push(describeImportError(result.error));
        return { song: null, report };
    }

    const converted: AIImportReport = result.report;
    const meta = (data as { meta?: { title?: unknown } }).meta;
    report.title = typeof meta?.title === 'string' ? meta.title : null;
    report.warnings = [...converted.warnings];
    report.tracksConverted = converted.tracksConverted;
    report.notesConverted = converted.notesConverted;
    report.tempo = result.song.tempo;
    report.stepCount = result.song.stepCount ?? 32;
    report.timeSignature = result.song.timeSignature ?? [4, 4];
    report.measureCount = result.song.songStructure.length;

    if (strict && report.warnings.length > 0) {
        report.errors = report.warnings.map((w) => `strict: ${w}`);
        return { song: null, report };
    }

    report.ok = true;
    const song = engine303 ? force303Engine(result.song, engine303) : result.song;
    return { song, report };
}

/** Base64 of `bytes`, chunked so a multi-megabyte WAV does not blow the call stack. */
export function bytesToBase64(bytes: Uint8Array): string {
    let binary = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
        binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    }
    return btoa(binary);
}
