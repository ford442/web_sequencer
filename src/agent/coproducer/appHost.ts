/**
 * The co-producer host over the live app state: `window.__HYPHON_AGENT__.coproducer`.
 *
 * `getSong` reads what the save path writes (the project doc's bound fields,
 * see `useSongStorage/save.ts`) minus the audio: no embedded samples, so a
 * tool call never encodes WAVs and no sample data ever reaches the model.
 * `commit` writes back only the parts an edit changed, through the setters
 * the UI uses — live-pattern steps go through `handleReplaceManyTrackSteps`,
 * the piano roll's commit, and arrangement edits through `editArrangement` —
 * so the transport keeps running and nothing is reloaded.
 *
 * Each tool call is one `agent` edit of the project doc (#1597 P2): one
 * transaction under the co-producer's own origin, so it is one step of the
 * co-producer's undo history, labelled with the tool call, and the human's
 * Ctrl/Cmd+Z never undoes it (nor does `undo` here undo the human's edits).
 * Undoing every step of a turn returns the song it started from.
 */

import type { AppState } from '../../contexts/AppStateContext';
import type { Note, PartSequence, SavedSongData, TrackKey } from '../../types';
import { SAVED_SONG_DATA_VERSION, TRACK_KEYS } from '../../constants';
import { automationStore } from '../../stores/automationStore';
import { noteFxStore } from '../../stores/noteFxStore';
import { transportMixStore } from '../../stores/transportMixStore';
import { migrateTrackStorage } from '../../utils/trackStorageUtils';
import { resolveSongMeter } from '../../utils/songMeter';
import { exportAISong, type AISongExport, type AISongExportOptions } from '../../importers/ai-song/exportAISong';
import type { AgentExportResult, AgentRenderResult } from '../agentApi';
import type { CoproducerExportFormat, CoproducerHost } from './host';
import { liveProject } from '../../collab/liveProject';
import { readBoundSong } from '../../hooks/useSongStorage/save';
import { COPRODUCER_TOOLS, runCoproducerTool, type CoproducerToolDefinition, type CoproducerToolResult } from './tools';

/** `window.__HYPHON_AGENT__.coproducer`. */
export interface HyphonAgentCoproducer {
    /** Tool definitions for the Messages API (the agent loop passes them to `betaTool`). */
    tools: () => readonly CoproducerToolDefinition[];
    /** Run one tool call on the open song. Never throws; failures are `isError` results. */
    run: (name: string, input: unknown) => Promise<CoproducerToolResult>;
    /** Labels of the co-producer steps that can be undone, oldest first. */
    history: () => string[];
    /** Undo the last co-producer step. False when there is none. */
    undo: () => Promise<boolean>;
    /** Files `export` offered, oldest first. */
    downloads: () => ReadonlyArray<{ filename: string; base64: string }>;
}

export interface AppHostDeps {
    getState: () => AppState;
    /** Resolves once the app has committed (and `getState` shows) what was just set. */
    settle: (quietMs?: number) => Promise<void>;
    renderMix: (options: { stems: boolean }) => Promise<AgentRenderResult>;
    exportRbs: () => Promise<AgentExportResult>;
    exportMidi: () => Promise<AgentExportResult>;
    exportXm: () => Promise<AgentExportResult>;
    /** WAV of the master render, as a file. */
    exportWav: () => Promise<AgentExportResult>;
}

type Storage = Record<TrackKey, (PartSequence | PartSequence[] | null)[]>;

/** The open song as the save path writes it, without audio. */
export function songSnapshot(s: AppState): SavedSongData {
    const bound = readBoundSong();
    const trackParamStorage = s.rbsArrangementExtrasRef.current?.trackParamStorage;
    const optional = <K extends keyof SavedSongData>(key: K, value: SavedSongData[K] | undefined) =>
        (value === undefined ? {} : { [key]: value }) as Partial<SavedSongData>;
    return {
        version: SAVED_SONG_DATA_VERSION,
        pattern: bound.pattern,
        params: bound.params,
        trackStorage: bound.trackStorage,
        activeTrackSlots: bound.activeTrackSlots,
        arrangement: bound.arrangement,
        songStructure: bound.songStructure,
        tempo: bound.tempo,
        stepCount: bound.stepCount,
        timeSignature: bound.timeSignature,
        swing: bound.swing,
        ...optional('trackLengths', bound.trackLengths as SavedSongData['trackLengths']),
        ttsPhrases: bound.ttsPhrases,
        ...optional('automationLanes', bound.automationLanes as SavedSongData['automationLanes']),
        ...optional('noteFx', bound.noteFx as SavedSongData['noteFx']),
        ...optional('trackParamStorage', trackParamStorage),
    } as SavedSongData;
}

const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);

/** Live-pattern changes as `handleReplaceManyTrackSteps` edits (one per track or sampler bank). */
function liveEdits(prev: SavedSongData, next: SavedSongData): Array<{ trackKey: TrackKey; bankIndex: number; steps: (Note | null)[] }> {
    const edits: Array<{ trackKey: TrackKey; bankIndex: number; steps: (Note | null)[] }> = [];
    for (const key of TRACK_KEYS) {
        const a = prev.pattern[key];
        const b = next.pattern[key];
        if (a === b) continue;
        if (key === 'sampler') {
            (b as PartSequence[]).forEach((bank, i) => {
                if (!same(bank, (a as PartSequence[])[i])) edits.push({ trackKey: key, bankIndex: i, steps: bank.steps });
            });
        } else if (!same(a, b)) {
            edits.push({ trackKey: key, bankIndex: 0, steps: (b as PartSequence).steps });
        }
    }
    return edits;
}

/**
 * Write the parts of `next` that differ from `prev` through the app's own
 * setters. Compared by value: `prev` is read fresh from the doc, so identity
 * says nothing.
 */
function applySong(s: AppState, prev: SavedSongData, next: SavedSongData): void {
    const edits = liveEdits(prev, next);
    if (edits.length > 0) s.handleReplaceManyTrackSteps(edits);
    if (!same(next.trackStorage, prev.trackStorage)) s.setTrackStorage(migrateTrackStorage(next.trackStorage) as Storage);
    if (!same(next.activeTrackSlots, prev.activeTrackSlots)) s.setActiveTrackSlots(next.activeTrackSlots as Record<TrackKey, number>);

    const p = next.params;
    const q = prev.params;
    if (!same(p.synthA, q.synthA)) s.setSynthA(p.synthA);
    if (!same(p.synthB, q.synthB)) s.setSynthB(p.synthB);
    if (p.bass2 && !same(p.bass2, q.bass2)) s.setBass2(p.bass2);
    if (!same(p.kick, q.kick)) s.setKick(p.kick);
    if (!same(p.snare, q.snare)) s.setSnare(p.snare);
    if (!same(p.closedHat, q.closedHat)) s.setClosedHat(p.closedHat);
    if (!same(p.openHat, q.openHat)) s.setOpenHat(p.openHat);
    if (!same(p.sampler, q.sampler)) s.setSampler(p.sampler);

    if (next.tempo !== prev.tempo) s.setTempo(next.tempo);
    const meter = resolveSongMeter(next);
    if (!same(meter, resolveSongMeter(prev))) transportMixStore.applyMeter(meter);
    if (next.arrangement && !same(next.arrangement, prev.arrangement)) {
        const arrangement = next.arrangement;
        s.editArrangement(() => arrangement);
    }
    if (!same(next.automationLanes ?? [], prev.automationLanes ?? [])) automationStore.importLanes(next.automationLanes ?? []);
    if (!same(next.noteFx ?? {}, prev.noteFx ?? {})) noteFxStore.importChains(next.noteFx);
    if (next.ttsPhrases && !same(next.ttsPhrases, prev.ttsPhrases)) s.setTtsPhrases(next.ttsPhrases);
    if (next.trackParamStorage !== prev.trackParamStorage) {
        s.rbsArrangementExtrasRef.current = { ...(s.rbsArrangementExtrasRef.current ?? {}), trackParamStorage: next.trackParamStorage };
    }
}

export function createAppCoproducer(deps: AppHostDeps): { coproducer: HyphonAgentCoproducer; exportAISong: (options?: AISongExportOptions) => AISongExport } {
    const downloads: Array<{ filename: string; base64: string }> = [];
    const state = deps.getState;

    const exporters: Record<CoproducerExportFormat, () => Promise<AgentExportResult>> = {
        rbs: deps.exportRbs,
        mid: deps.exportMidi,
        xm: deps.exportXm,
        wav: deps.exportWav,
    };

    const host: CoproducerHost = {
        getSong: () => songSnapshot(state()),
        async commit(song, label) {
            liveProject.edit('agent', () => applySong(state(), songSnapshot(state()), song), label);
            await deps.settle(50);
        },
        async load(song, label) {
            const s = state();
            if (s.isPlaying) await s.handlePlayToggle();
            // A load inside the agent's edit is that step, not a history reset.
            await liveProject.editAsync('agent', () => s.loadImportedAISong(song), label);
            await deps.settle();
        },
        render: (options) => deps.renderMix(options),
        async exportFile(format) {
            const file = await exporters[format]();
            if (file.ok) downloads.push({ filename: file.filename, base64: file.base64 });
            return file;
        },
    };

    return {
        exportAISong: (options) => exportAISong(songSnapshot(state()), options),
        coproducer: {
            tools: () => COPRODUCER_TOOLS,
            run: (name, input) => runCoproducerTool(name, input, host),
            history: () => liveProject.stepLabels('agent'),
            async undo() {
                if (!liveProject.undo('agent')) return false;
                await deps.settle(50);
                return true;
            },
            downloads: () => downloads,
        },
    };
}
