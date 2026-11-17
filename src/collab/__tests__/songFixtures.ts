/**
 * Every song the collab codec is tested on: each file in `test-fixtures/`
 * imported the way the app imports it, plus a synthetic song that sets every
 * `SavedSongData` field (and a few the codec has never heard of).
 */

import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { SavedSongData, TrackKey } from '@/types';
import { AISongImporter, parseAISongJSON } from '@/importers/ai-song';
import { RbsImporter } from '@/importers/rbs/RbsImporter';
import type { HyphonSong } from '@/importers/rbs';
import { parseSmfBytes } from '@/importers/smf/SmfParser';
import { convertToHyphonSong as convertSmf } from '@/importers/smf/SmfImporter';
import type { HyphonSmfSong } from '@/importers/smf';
import { convertHyphonLanes } from '@/stores/automationStore';
import { DEFAULT_BASS2_PARAMS, DEFAULT_SAMPLER_PARAMS } from '@/constants';
import { createDefaultSessionDocument } from '@/session/defaults';
import {
    SAVED_SONG_DATA_VERSION,
    createEmptyTrackStorage,
    defaultActiveTrackSlots,
    migrateTrackStorage,
} from '@/utils/trackStorageUtils';
import { parseCorpusFile } from '@/__tests__/rbs/corpusUtils';

const FIXTURES = resolve(process.cwd(), 'test-fixtures');

export interface SongFixture {
    name: string;
    song: SavedSongData;
}

function aiSongFixtures(): SongFixture[] {
    const dir = resolve(FIXTURES, 'ai-song');
    const out: SongFixture[] = [];
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
        const parsed = parseAISongJSON(readFileSync(resolve(dir, file), 'utf-8'));
        if (!parsed.success) throw new Error(`${file}: ${parsed.error}`);
        const result = new AISongImporter().convert(parsed.data);
        if (!result.success) throw new Error(`${file}: ${JSON.stringify(result.error)}`);
        out.push({ name: `ai-song/${file}`, song: result.song });
    }
    // The recorded imports are songs in their own right (and pin key order).
    const expectedDir = resolve(dir, 'expected');
    for (const file of readdirSync(expectedDir).filter((f) => f.endsWith('.json')).sort()) {
        const recorded = JSON.parse(readFileSync(resolve(expectedDir, file), 'utf-8')) as { song: SavedSongData };
        out.push({ name: `ai-song/expected/${file}`, song: recorded.song });
    }
    return out;
}

/** The fields `useSongStorage.handleRbsImport` / `handleSmfImport` build from an imported song. */
function savedFromImport(song: HyphonSong | HyphonSmfSong): SavedSongData {
    const arrangement = song.songArrangement;
    const trackStorage = arrangement ? migrateTrackStorage(arrangement.trackStorage) : createEmptyTrackStorage();
    if (!arrangement) {
        for (const key of Object.keys(trackStorage) as TrackKey[]) {
            trackStorage[key][0] = song.pattern[key];
        }
    }
    const rbs = 'params' in song ? song : null;
    const rbsArrangement = rbs?.songArrangement;
    return {
        version: SAVED_SONG_DATA_VERSION,
        pattern: song.pattern,
        tempo: song.tempo,
        stepCount: song.stepCount,
        timeSignature: song.timeSignature,
        ...(rbs ? { swing: rbs.swing } : {}),
        ambianceUrl: '',
        backgroundImage: '',
        params: {
            synthA: rbs?.params.synthA ?? LIVE_PARAMS_STANDIN.synthA,
            synthB: rbs?.params.synthB ?? LIVE_PARAMS_STANDIN.synthB,
            bass2: rbs?.params.bass2 ?? DEFAULT_BASS2_PARAMS,
            kick: rbs?.params.kick ?? LIVE_PARAMS_STANDIN.kick,
            snare: rbs?.params.snare ?? LIVE_PARAMS_STANDIN.snare,
            closedHat: rbs?.params.closedHat ?? LIVE_PARAMS_STANDIN.closedHat,
            openHat: rbs?.params.openHat ?? LIVE_PARAMS_STANDIN.openHat,
            sampler: DEFAULT_SAMPLER_PARAMS,
        },
        trackStorage,
        activeTrackSlots: rbsArrangement?.activeTrackSlots
            ? { ...defaultActiveTrackSlots(), ...rbsArrangement.activeTrackSlots }
            : defaultActiveTrackSlots(),
        songStructure: arrangement?.songStructure ?? [],
        ttsPhrases: Array<string>(8).fill('Hello World'),
        ...(song.automation?.length
            ? { automationLanes: convertHyphonLanes(song.automation as Parameters<typeof convertHyphonLanes>[0]) }
            : {}),
        ...(rbsArrangement?.loopStart != null ? { rbsLoopStart: rbsArrangement.loopStart } : {}),
        ...(rbsArrangement?.loopEnd != null ? { rbsLoopEnd: rbsArrangement.loopEnd } : {}),
        ...(rbs?.pcfFilter ? { pcfFilter: rbs.pcfFilter } : {}),
        ...(rbsArrangement?.trackParamStorage ? { trackParamStorage: rbsArrangement.trackParamStorage } : {}),
    };
}

// SMF imports keep the live synth params; the minimal AI song's stand in for them.
const LIVE_PARAMS_STANDIN = (() => {
    const parsed = parseAISongJSON(readFileSync(resolve(FIXTURES, 'ai-song/minimal.json'), 'utf-8'));
    if (!parsed.success) throw new Error(`minimal.json: ${parsed.error}`);
    const base = new AISongImporter().convert(parsed.data);
    if (!base.success) throw new Error('minimal.json no longer imports');
    return base.song.params;
})();

async function rbsFixtures(): Promise<SongFixture[]> {
    const dir = resolve(FIXTURES, 'rbs/generated');
    const out: SongFixture[] = [];
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.rbs')).sort()) {
        const parsed = await parseCorpusFile(resolve(dir, file));
        if (!parsed.success) throw new Error(`${file}: ${JSON.stringify(parsed.error)}`);
        const converted = new RbsImporter().convertToHyphonSong(parsed.data);
        if (!converted.success) throw new Error(`${file}: import failed`);
        out.push({ name: `rbs/${file}`, song: savedFromImport(converted.song) });
        // The importer's own output too: unknown top-level keys, Dates, nesting.
        out.push({ name: `rbs/${file} (HyphonSong)`, song: converted.song as unknown as SavedSongData });
    }
    return out;
}

function midiFixtures(): SongFixture[] {
    return readdirSync(FIXTURES)
        .filter((f) => f.endsWith('.mid'))
        .sort()
        .map((file) => {
            const parsed = parseSmfBytes(new Uint8Array(readFileSync(resolve(FIXTURES, file))), { filename: file });
            if (!parsed.success) throw new Error(`${file}: parse failed`);
            const converted = convertSmf(parsed.data);
            return { name: file, song: savedFromImport(converted.song) };
        });
}

/** A song with every field set, including shapes no importer writes yet. */
export function kitchenSinkSong(base: SavedSongData): SavedSongData {
    const lane = (id: string) => ({
        id,
        target: 'synthA',
        parameter: 'cutoff',
        name: `Cutoff ${id}`,
        points: [
            { step: 0, value: 0.1 },
            { step: 8, value: 0.9 },
        ],
        interpolation: 'linear',
        source: 'manual',
        scope: 'song',
        enabled: true,
    });
    return {
        ...base,
        version: 5,
        swing: 58,
        stepCount: 32,
        timeSignature: [7, 8],
        trackLengths: { kick: 12, openHat: 20 },
        ambianceUrl: 'https://example.invalid/ambience.ogg',
        backgroundImage: 'data:image/png;base64,iVBORw0KGgo=',
        embeddedSamples: { 0: 'data:audio/wav;base64,UklGRg==', 5: 'data:audio/wav;base64,AAAA' },
        ttsPhrases: ['Hello World', 'ünïcödé 🎛️ phrase', '', 'two\nlines', 'e', 'f', 'g', 'h'],
        automationLanes: [lane('lane-1'), lane('lane-2')] as SavedSongData['automationLanes'],
        arrangement: {
            lengthSteps: 128,
            clips: [
                { id: 'clip-1', track: 'kick', patternSlot: 0, startStep: 0, lengthSteps: 64, loop: true },
                {
                    id: 'clip-2',
                    track: 'partA',
                    patternSlot: 3,
                    startStep: 32,
                    lengthSteps: 48,
                    loop: false,
                    offsetSteps: 4,
                    lanes: [lane('clip-lane')] as NonNullable<SavedSongData['automationLanes']>,
                },
            ],
        },
        session: createDefaultSessionDocument(),
        audioGraph: { schemaVersion: 1, presetId: 'classic-electribe' },
        pcfFilter: {
            enabled: true,
            filterType: 'bp',
            cutoff: 0.4,
            resonance: 0.7,
            envAmount: 0.2,
            decay: 0.5,
            pattern: [0, 32, 64, 96, 127, 96, 64, 32, 0, 32, 64, 96, 127, 96, 64, 32],
            target: { tb303A: true, tb303B: false, drums: true },
        },
        midiMappings: [{ id: 'm1', kind: 'cc', channel: 0, number: 74, target: 'synthA.filterCutoff' }] as unknown as SavedSongData['midiMappings'],
        wam2: {
            schema: 1,
            plugins: [{ slotId: 'slot-a', packageId: 'pkg', version: '1.0.0', state: { blob: 'AAEC' } }],
        } as unknown as SavedSongData['wam2'],
        rbsLoopStart: 2,
        rbsLoopEnd: 14,
        // Fields this build of the codec does not know (they go to `extra`).
        ...({
            futureField: { nested: [1, { deep: true }], text: 'x' },
            '\u0001reserved-looking': 'escaped, not dropped',
            emptyList: [],
            emptyObject: {},
        } as object),
    } as SavedSongData;
}

let cache: Promise<SongFixture[]> | null = null;

export function loadSongFixtures(): Promise<SongFixture[]> {
    cache ??= (async () => {
        const ai = aiSongFixtures();
        const all = [...ai, ...(await rbsFixtures()), ...midiFixtures()];
        all.push({ name: 'kitchen sink', song: kitchenSinkSong(ai[0].song) });
        return all;
    })();
    return cache;
}
