/**
 * The co-producer through the agent hook (`window.__HYPHON_AGENT__`), headless:
 * `createAgentApi` over an app state whose setters are the app's own stores,
 * bound to a running project runtime (#1597 P2). A scripted turn reads the
 * song, edits it with three tools — each one step of the co-producer's undo
 * history — and undoing every step gives back the song it started from, byte
 * for byte, while the human's history stays empty.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import full from '../../../test-fixtures/ai-song/full.json';
import songMode from '../../../test-fixtures/ai-song/song-mode.json';
import type { AppState } from '../../contexts/AppStateContext';
import { AISongImporter, type AISongData } from '../../importers/ai-song';
import { exportAISong } from '../../importers/ai-song/exportAISong';
import { automationStore } from '../../stores/automationStore';
import { transportMixStore } from '../../stores/transportMixStore';
import { instrumentStore } from '../../stores/instrumentStore';
import { patternStore } from '../../stores/patternStore';
import { samplerBanksStore } from '../../stores/samplerBanksStore';
import { arrangementStore, sessionDocumentStore } from '../../stores/songRecordStore';
import { noteFxStore } from '../../stores/noteFxStore';
import { liveProject } from '../../collab/liveProject';
import { startLiveProject, stopLiveProject } from '../../collab/liveProjectRuntime';
import { loadSongData } from '../../hooks/useSongStorage/load';
import { normalizeSamplerParams } from '../../hooks/useSongStorage/migrate';
import type { Arrangement } from '../../types/song';
import type { Note, Pattern, SavedSongData, TrackKey } from '../../types';
import { createAgentApi, createAgentStateHandle, type HyphonAgentApi } from '../agentApi';
import { songSnapshot } from '../coproducer/appHost';

const META = { title: 'Hook', author: 'tests', createdAt: '2026-11-02T00:00:00Z', generator: 'vitest', prompt: 'round trip' };

function importStrict(ai: unknown): SavedSongData {
    const result = new AISongImporter().convert(structuredClone(ai) as AISongData, { strict: true });
    if (!result.success) throw new Error(JSON.stringify(result.error));
    return result.song;
}

/**
 * The app state `AgentBridge` publishes, loaded with `song` the way
 * `loadCloudData` loads one. Its setters are the stores' own.
 */
async function fakeApp(song: SavedSongData) {
    startLiveProject();
    const rbsArrangementExtrasRef = { current: null as AppState['rbsArrangementExtrasRef']['current'] };
    await loadSongData(song, { audioEngine: null, setSampleBuffers: () => {}, rbsExtrasRef: rbsArrangementExtrasRef });
    const refs = instrumentStore.refs;
    const set = <K extends keyof typeof refs>(key: K) => (value: unknown) =>
        instrumentStore.set(key, value as never);
    // The piano roll's commit (`usePatternHandlers.handleReplaceManyTrackSteps`).
    const replaceMany = vi.fn((edits: Array<{ trackKey: TrackKey; bankIndex: number; steps: (Note | null)[] }>) => {
        let next: Pattern = patternStore.getSnapshot();
        for (const { trackKey, bankIndex, steps } of edits) {
            if (trackKey === 'sampler') {
                const sampler = [...next.sampler];
                sampler[bankIndex] = { ...sampler[bankIndex], steps };
                next = { ...next, sampler };
            } else {
                next = { ...next, [trackKey]: { ...next[trackKey], steps } };
            }
        }
        patternStore.set(next);
    });
    const editArrangement = vi.fn((updater: (prev: Arrangement) => Arrangement) => arrangementStore.set(updater));
    const s: Record<string, unknown> = {
        isPlaying: false,
        rbsArrangementExtrasRef,
        patternRef: patternStore.ref,
        synthARef: refs.synthA,
        synthBRef: refs.synthB,
        bass2Ref: refs.bass2,
        kickRef: refs.kick,
        snareRef: refs.snare,
        closedHatRef: refs.closedHat,
        openHatRef: refs.openHat,
        samplerRef: refs.sampler,
        setSynthA: set('synthA'), setSynthB: set('synthB'), setBass2: set('bass2'), setKick: set('kick'),
        setSnare: set('snare'), setClosedHat: set('closedHat'), setOpenHat: set('openHat'), setSampler: set('sampler'),
        setTrackStorage: samplerBanksStore.setTrackStorage,
        setActiveTrackSlots: samplerBanksStore.setActiveTrackSlots,
        setTtsPhrases: samplerBanksStore.setTtsPhrases,
        setTempo: transportMixStore.setTempo,
        handleReplaceManyTrackSteps: replaceMany,
        editArrangement,
        buildSmfExport: () => Promise.resolve({ success: true, blob: new Blob([new Uint8Array([77, 84, 104, 100])]), filename: 'song.mid', warnings: [] }),
    };
    const handle = createAgentStateHandle(s as unknown as AppState);
    const api: HyphonAgentApi = createAgentApi(handle);
    return { api, replaceMany, editArrangement, snapshot: () => songSnapshot(handle.getSnapshot()) };
}

const json = (value: unknown) => JSON.stringify(value);

function resetStores(): void {
    stopLiveProject();
    automationStore.reset();
    transportMixStore.reset();
    instrumentStore.reset();
    patternStore.reset();
    arrangementStore.reset();
    sessionDocumentStore.reset();
    noteFxStore.reset();
}

beforeEach(resetStores);
afterEach(resetStores);

describe('window.__HYPHON_AGENT__.exportAISong', () => {
    it('reads the open song back as the AI song it was imported from', async () => {
        const song = importStrict(full);
        const { api } = await fakeApp(song);
        const out = api.exportAISong({ meta: META });
        expect(out.losses).toEqual([]);
        // The load path gives sampler banks their mode and nested expressiveness.
        const loaded = { ...song, params: { ...song.params, sampler: normalizeSamplerParams(song.params.sampler) } };
        expect(out.song).toEqual(exportAISong(loaded, { meta: META }).song);
        expect(out.song.tracks?.synthA?.notes).toHaveLength(7);
    });
});

describe('window.__HYPHON_AGENT__.coproducer', () => {
    it('drives a scripted multi-tool turn, one undo step per edit, and undoes it to a byte-identical song', async () => {
        const { api, replaceMany, editArrangement, snapshot } = await fakeApp(importStrict(songMode));
        const start = json(snapshot());
        const run = async <T>(name: string, input: unknown) => {
            const result = await api.coproducer.run(name, input);
            expect(result.isError, result.content).toBe(false);
            return JSON.parse(result.content) as T;
        };

        const read = await run<{ song: AISongData }>('get_song', {});
        expect(read.song.patterns?.slot0.tracks.kick).toHaveLength(16);
        expect(api.coproducer.tools().map((t) => t.name)).toContain('render_and_measure');

        const edit = await run<{ patterns: unknown[] }>('edit_pattern', {
            track: 'closedHat', slot: 0, edits: [{ step: 3, action: 'set', velocity: 0.7 }, { step: 2, action: 'clear' }],
        });
        expect(edit.patterns[0]).toMatchObject({ track: 'closedHat', slot: 0, changedSteps: 2 });
        // The live slot went through the piano roll's commit.
        expect(replaceMany).toHaveBeenCalledTimes(1);
        expect(snapshot().pattern.closedHat.steps[3]).toMatchObject({ velocity: 0.7 });

        await run('set_params', { track: 'bass2', knobs: { filterCutoff: 450, envMod: 0.8 }, swing: 57 });
        expect(snapshot().params.bass2).toMatchObject({ cutoff: 450, envMod: 0.8 });
        expect(transportMixStore.getMeter().swing).toBe(57);

        await run('arrange', { ops: [{ op: 'place', track: 'bass2', slot: 0, start_measure: 0, measures: 2 }] });
        expect(editArrangement).toHaveBeenCalledTimes(1);
        const after = await run<{ song: AISongData }>('get_song', {});
        expect(after.song.song?.[0].bass2).toBe('slot0');

        expect(api.coproducer.history()).toEqual([
            'Co-producer: edit_pattern closedHat slot 0',
            'Co-producer: set_params bass2',
            'Co-producer: arrange (1 op)',
        ]);
        expect(json(snapshot())).not.toBe(start);
        // One step per tool call, all the co-producer's; none of them is the human's.
        expect(liveProject.getSnapshot().entries.map((e) => [e.editor, e.label])).toEqual([
            ['agent', 'Co-producer: edit_pattern closedHat slot 0'],
            ['agent', 'Co-producer: set_params bass2'],
            ['agent', 'Co-producer: arrange (1 op)'],
        ]);
        expect(liveProject.canUndo('human')).toBe(false);

        while (await api.coproducer.undo()) { /* revert the turn */ }
        expect(api.coproducer.history()).toEqual([]);
        expect(json(snapshot())).toBe(start);
    });

    it('answers an invalid input with an error and commits nothing', async () => {
        const { api, snapshot } = await fakeApp(importStrict(full));
        const before = json(snapshot());
        const result = await api.coproducer.run('edit_pattern', { track: 'synthA', slot: 0, edits: [{ step: 0, action: 'set', note: 'X9' }] });
        expect(result.isError).toBe(true);
        expect(api.coproducer.history()).toEqual([]);
        expect(json(snapshot())).toBe(before);
        expect(await api.coproducer.undo()).toBe(false);
    });

    it('never puts sample audio in what it reads', async () => {
        const song = importStrict(full);
        const { api } = await fakeApp({ ...song, embeddedSamples: { 0: 'data:audio/wav;base64,UklGRg==' } });
        const read = await api.coproducer.run('get_song', {});
        expect(read.content).not.toContain('UklGRg');
        expect(read.content).not.toContain('embeddedSamples');
    });

    it('offers an exported file for download', async () => {
        const { api } = await fakeApp(importStrict(full));
        const result = await api.coproducer.run('export', { format: 'mid' });
        expect(JSON.parse(result.content)).toEqual({ offered: 'song.mid', bytes: 4, warnings: [] });
        expect(api.coproducer.downloads().map((d) => d.filename)).toEqual(['song.mid']);
    });
});
