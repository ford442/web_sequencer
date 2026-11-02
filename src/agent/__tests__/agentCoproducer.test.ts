/**
 * The co-producer through the agent hook (`window.__HYPHON_AGENT__`), headless:
 * `createAgentApi` over an app state whose setters behave like the app's. A
 * scripted turn reads the song, edits it with three tools, and undoing every
 * step gives back the song it started from, byte for byte.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import full from '../../../test-fixtures/ai-song/full.json';
import songMode from '../../../test-fixtures/ai-song/song-mode.json';
import type { AppState } from '../../contexts/AppStateContext';
import { AISongImporter, type AISongData } from '../../importers/ai-song';
import { exportAISong } from '../../importers/ai-song/exportAISong';
import { projectArrangement, songStructureToArrangement } from '../../arrangement/model';
import { automationStore } from '../../stores/automationStore';
import { transportMixStore } from '../../stores/transportMixStore';
import { resolveSongMeter } from '../../utils/songMeter';
import { migrateTrackStorage } from '../../utils/trackStorageUtils';
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
 * `loadCloudData` loads one. Every setter commits a new snapshot.
 */
function fakeApp(song: SavedSongData) {
    const meter = resolveSongMeter(song);
    transportMixStore.applyMeter(meter);
    automationStore.importLanes(song.automationLanes ?? []);
    const ref = <T>(current: T) => ({ current });
    const arrangement: Arrangement = song.arrangement
        ?? songStructureToArrangement(song.songStructure as Array<Partial<Record<TrackKey, unknown>>>, meter.stepCount);
    const patternRef = ref(song.pattern);
    const undoRedo = { push: vi.fn() };
    const s: Record<string, unknown> = {
        pattern: song.pattern,
        patternRef,
        trackStorage: migrateTrackStorage(song.trackStorage),
        activeTrackSlots: song.activeTrackSlots,
        arrangement,
        songStructure: projectArrangement(arrangement, meter.stepCount),
        tempo: song.tempo,
        ttsPhrases: Array(8).fill('Hello World'),
        isPlaying: false,
        rbsArrangementExtrasRef: ref({ trackParamStorage: song.trackParamStorage }),
        undoRedo,
        synthARef: ref(song.params.synthA),
        synthBRef: ref(song.params.synthB),
        bass2Ref: ref(song.params.bass2),
        kickRef: ref(song.params.kick),
        snareRef: ref(song.params.snare),
        closedHatRef: ref(song.params.closedHat),
        openHatRef: ref(song.params.openHat),
        samplerRef: ref(song.params.sampler),
    };
    const handle = createAgentStateHandle({ ...s } as unknown as AppState);
    const commit = () => handle.publish({ ...s } as unknown as AppState);
    const setter = (field: string) => (value: unknown) => {
        s[field] = typeof value === 'function' ? (value as (prev: unknown) => unknown)(s[field]) : value;
        commit();
    };
    for (const [field, name] of [
        ['synthA', 'setSynthA'], ['synthB', 'setSynthB'], ['bass2', 'setBass2'], ['kick', 'setKick'], ['snare', 'setSnare'],
        ['closedHat', 'setClosedHat'], ['openHat', 'setOpenHat'], ['sampler', 'setSampler'],
        ['trackStorage', 'setTrackStorage'], ['activeTrackSlots', 'setActiveTrackSlots'], ['tempo', 'setTempo'],
        ['ttsPhrases', 'setTtsPhrases'], ['pattern', 'setPattern'],
    ]) s[name] = setter(field);
    // The piano roll's commit (`usePatternHandlers.handleReplaceManyTrackSteps`).
    const replaceMany = vi.fn((edits: Array<{ trackKey: TrackKey; bankIndex: number; steps: (Note | null)[] }>) => {
        const prev = patternRef.current;
        undoRedo.push(prev);
        let next: Pattern = prev;
        for (const { trackKey, bankIndex, steps } of edits) {
            if (trackKey === 'sampler') {
                const sampler = [...next.sampler];
                sampler[bankIndex] = { ...sampler[bankIndex], steps };
                next = { ...next, sampler };
            } else {
                next = { ...next, [trackKey]: { ...next[trackKey], steps } };
            }
        }
        patternRef.current = next;
        s.pattern = next;
        commit();
    });
    const editArrangement = vi.fn((updater: (prev: Arrangement) => Arrangement) => {
        const next = updater(s.arrangement as Arrangement);
        s.arrangement = next;
        s.songStructure = projectArrangement(next, transportMixStore.getMeter().stepCount);
        commit();
    });
    s.handleReplaceManyTrackSteps = replaceMany;
    s.editArrangement = editArrangement;
    s.buildSmfExport = () => Promise.resolve({ success: true, blob: new Blob([new Uint8Array([77, 84, 104, 100])]), filename: 'song.mid', warnings: [] });
    commit();
    const api: HyphonAgentApi = createAgentApi(handle);
    return { api, replaceMany, editArrangement, undoRedo, snapshot: () => songSnapshot(handle.getSnapshot()) };
}

const json = (value: unknown) => JSON.stringify(value);

beforeEach(() => {
    automationStore.reset();
    transportMixStore.reset();
});
afterEach(() => {
    automationStore.reset();
    transportMixStore.reset();
});

describe('window.__HYPHON_AGENT__.exportAISong', () => {
    it('reads the open song back as the AI song it was imported from', () => {
        const song = importStrict(full);
        const { api } = fakeApp(song);
        const out = api.exportAISong({ meta: META });
        expect(out.losses).toEqual([]);
        expect(out.song).toEqual(exportAISong(song, { meta: META }).song);
        expect(out.song.tracks?.synthA?.notes).toHaveLength(7);
    });
});

describe('window.__HYPHON_AGENT__.coproducer', () => {
    it('drives a scripted multi-tool turn, one undo step per edit, and undoes it to a byte-identical song', async () => {
        const { api, replaceMany, editArrangement, undoRedo, snapshot } = fakeApp(importStrict(songMode));
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
        // The live slot went through the piano roll's commit, pattern undo included.
        expect(replaceMany).toHaveBeenCalledTimes(1);
        expect(undoRedo.push).toHaveBeenCalledTimes(1);
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

        while (await api.coproducer.undo()) { /* revert the turn */ }
        expect(api.coproducer.history()).toEqual([]);
        expect(json(snapshot())).toBe(start);
    });

    it('answers an invalid input with an error and commits nothing', async () => {
        const { api, snapshot } = fakeApp(importStrict(full));
        const before = json(snapshot());
        const result = await api.coproducer.run('edit_pattern', { track: 'synthA', slot: 0, edits: [{ step: 0, action: 'set', note: 'X9' }] });
        expect(result.isError).toBe(true);
        expect(api.coproducer.history()).toEqual([]);
        expect(json(snapshot())).toBe(before);
        expect(await api.coproducer.undo()).toBe(false);
    });

    it('never puts sample audio in what it reads', async () => {
        const song = importStrict(full);
        const { api } = fakeApp({ ...song, embeddedSamples: { 0: 'data:audio/wav;base64,UklGRg==' } });
        const read = await api.coproducer.run('get_song', {});
        expect(read.content).not.toContain('UklGRg');
        expect(read.content).not.toContain('embeddedSamples');
    });

    it('offers an exported file for download', async () => {
        const { api } = fakeApp(importStrict(full));
        const result = await api.coproducer.run('export', { format: 'mid' });
        expect(JSON.parse(result.content)).toEqual({ offered: 'song.mid', bytes: 4, warnings: [] });
        expect(api.coproducer.downloads().map((d) => d.filename)).toEqual(['song.mid']);
    });
});
