/**
 * The co-producer's tools as pure functions over a song (P1): no SDK, no app.
 * A plain host keeps the song and records every commit, so each test can
 * check what a tool returned, what it committed, and that a bad input changed
 * nothing and threw nothing.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';

import minimal from '../../../test-fixtures/ai-song/minimal.json';
import full from '../../../test-fixtures/ai-song/full.json';
import songMode from '../../../test-fixtures/ai-song/song-mode.json';
import { AISongImporter, type AISongData } from '../../importers/ai-song';
import type { PartSequence, SavedSongData } from '../../types';
import type { AgentExportResult, AgentRenderResult } from '../agentApi';
import type { CoproducerHost } from '../coproducer/host';
import { COPRODUCER_TOOLS, runCoproducerTool, unrenderedLanes } from '../coproducer/tools';
import { SYNTH_WAVEFORMS, LANE_PARAMETERS } from '../coproducer/knobs';
import { TOOL_INPUT_SCHEMAS } from '../coproducer/toolSchemas';
import { bytesToBase64 } from '../agentSong';

const ROOT = process.cwd();
const aiSchema = JSON.parse(readFileSync(resolve(ROOT, 'docs/schemas/ai-song.schema.json'), 'utf8')) as {
    $defs: Record<string, { enum?: string[] }>;
};
const ajv = new Ajv2020({ strict: true });
addFormats(ajv);
const validateAISong = ajv.compile(aiSchema as object);

function songOf(ai: unknown): SavedSongData {
    const result = new AISongImporter().convert(structuredClone(ai) as AISongData, { strict: true });
    if (!result.success) throw new Error(JSON.stringify(result.error));
    return result.song;
}

/** 16-bit stereo WAV of a quiet sine — what the render path hands back. */
function sineWav(seconds: number, freq: number, amp = 0.25, sampleRate = 8000): string {
    const frames = Math.round(seconds * sampleRate);
    const bytes = new Uint8Array(44 + frames * 4);
    const view = new DataView(bytes.buffer);
    const text = (o: number, t: string) => [...t].forEach((c, i) => view.setUint8(o + i, c.charCodeAt(0)));
    text(0, 'RIFF'); view.setUint32(4, 36 + frames * 4, true); text(8, 'WAVE');
    text(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 2, true);
    view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 4, true); view.setUint16(32, 4, true); view.setUint16(34, 16, true);
    text(36, 'data'); view.setUint32(40, frames * 4, true);
    for (let i = 0; i < frames; i++) {
        const v = Math.round(Math.sin((2 * Math.PI * freq * i) / sampleRate) * amp * 32767);
        view.setInt16(44 + i * 4, v, true);
        view.setInt16(46 + i * 4, v, true);
    }
    return bytesToBase64(bytes);
}

interface TestHost extends CoproducerHost {
    song: SavedSongData;
    commits: Array<{ label: string; song: SavedSongData }>;
    loads: string[];
}

function hostFor(song: SavedSongData): TestHost {
    const host: TestHost = {
        song,
        commits: [],
        loads: [],
        getSong: () => host.song,
        commit(next, label) {
            host.commits.push({ label, song: next });
            host.song = next;
            return Promise.resolve();
        },
        load(next, label) {
            host.loads.push(label);
            host.song = next;
            return Promise.resolve();
        },
        render({ stems }): Promise<AgentRenderResult> {
            const files = [{ path: 'stems/master.wav', base64: sineWav(2, 440) }];
            if (stems) files.push({ path: 'stems/partA.wav', base64: sineWav(2, 220, 0.1) });
            return Promise.resolve({
                files,
                report: { automation: { applied: ['synthA.filterCutoff'], notRendered: [] } } as unknown as AgentRenderResult['report'],
                metadata: { silencedTracks: ['partB'] },
                engineIssues: [],
            });
        },
        exportFile(format): Promise<AgentExportResult> {
            return Promise.resolve({ ok: true, filename: `song.${format}`, base64: btoa('abcdef'), warnings: [] });
        },
    };
    return host;
}

interface ErrorBody {
    error?: string;
    problems?: string[];
    errors?: string[];
    notes?: string[];
    patterns?: unknown;
    knobs?: unknown;
    lanes?: unknown;
    measures?: unknown;
    globals?: unknown;
}

/** What `get_song` answers. */
interface SongBody extends ErrorBody {
    song: AISongData;
    knobs: Record<string, Record<string, unknown> | Array<Record<string, unknown>>>;
    activeSlots: Record<string, number>;
    arrangement: { lengthSteps: number; clips: Array<{ id: string; track: string; pattern: string }> };
    notExported: string[];
}

interface Levels { peakDbfs: number; crestDb: number; centroidHz: number; integratedLufs: number; rmsDbfs: number }
interface MeasureBody extends ErrorBody {
    seconds: number;
    master: Levels & { bars: unknown[] };
    stems: Record<string, Levels>;
    silencedTracks: string[];
    automation: unknown;
}

const run = async <T extends ErrorBody = ErrorBody>(host: CoproducerHost, name: string, input: unknown) => {
    const result = await runCoproducerTool(name, input, host);
    const body = JSON.parse(result.content) as T;
    /** The error and every problem it lists, as plain text. */
    const text = [body.error, ...(body.problems ?? []), ...(body.errors ?? [])].filter(Boolean).join('\n');
    return { ...result, body, text };
};
const rowsOf = async (host: CoproducerHost) => (await run<SongBody>(host, 'get_song', {})).body.song.song ?? [];

describe('tool definitions', () => {
    it('lists the seven tools in a fixed order, each streaming its input eagerly', () => {
        expect(COPRODUCER_TOOLS.map((t) => t.name)).toEqual([
            'get_song', 'import_song', 'edit_pattern', 'set_params', 'arrange', 'render_and_measure', 'export',
        ]);
        for (const tool of COPRODUCER_TOOLS) {
            expect(tool.eager_input_streaming).toBe(true);
            expect(tool.input_schema.type).toBe('object');
            expect(tool.description.length).toBeGreaterThan(80);
        }
        // Byte-stable: the tool list heads the prompt cache.
        expect(JSON.stringify(COPRODUCER_TOOLS)).toBe(JSON.stringify(COPRODUCER_TOOLS.map((t) => ({ ...t }))));
    });

    it('sends strict tools only keywords strict tool use takes, every object closed', () => {
        const unsupported = /^(minimum|maximum|exclusiveMinimum|exclusiveMaximum|multipleOf|minLength|maxLength|pattern|minItems|maxItems|uniqueItems|minProperties|maxProperties|propertyNames|oneOf|if|then|else|not)$/;
        const walk = (node: unknown, path: string): void => {
            if (Array.isArray(node)) return node.forEach((n, i) => walk(n, `${path}[${i}]`));
            if (!node || typeof node !== 'object') return;
            const obj = node as Record<string, unknown>;
            if (obj.type === 'object') expect(obj.additionalProperties, `${path} must be closed`).toBe(false);
            for (const [key, value] of Object.entries(obj)) {
                if (key === 'properties') {
                    Object.entries(value as object).forEach(([k, v]) => walk(v, `${path}.${k}`));
                    continue;
                }
                expect(key, `${path}.${key}`).not.toMatch(unsupported);
                walk(value, `${path}.${key}`);
            }
        };
        for (const tool of COPRODUCER_TOOLS.filter((t) => t.strict)) walk(tool.input_schema, tool.name);
        // The ranges strict mode drops are still told to the model.
        const editSchema = JSON.stringify(COPRODUCER_TOOLS.find((t) => t.name === 'edit_pattern')!.input_schema);
        expect(editSchema).toContain('0–31');
        expect(editSchema).toContain('matches /^[A-G][#b]?[0-8]$/');
    });

    it('gives import_song the AI song schema itself (not strict: its patterns map is open-keyed)', () => {
        const tool = COPRODUCER_TOOLS.find((t) => t.name === 'import_song')!;
        expect(tool.strict).toBe(false);
        expect(tool.input_schema.oneOf).toEqual((aiSchema as unknown as { oneOf: unknown }).oneOf);
        expect(tool.input_schema.$defs).toEqual(aiSchema.$defs);
        expect(COPRODUCER_TOOLS.filter((t) => t.name !== 'import_song').every((t) => t.strict)).toBe(true);
    });

    it('knows every waveform the AI song schema allows', () => {
        const defs = aiSchema.$defs as Record<string, { enum?: string[]; anyOf?: Array<{ const?: string; $ref?: string }> }>;
        const fromSchema = (defs.Waveform.anyOf ?? []).flatMap((v) =>
            v.const !== undefined ? [v.const] : v.$ref === '#/$defs/MacroWaveform' ? defs.MacroWaveform.enum ?? [] : []);
        expect(fromSchema.length).toBeGreaterThan(40);
        expect([...SYNTH_WAVEFORMS].sort()).toEqual([...fromSchema].sort());
    });

    it('offers only lanes the live engine plays', () => {
        expect(LANE_PARAMETERS.kick).toEqual([]);
        expect(LANE_PARAMETERS.sampler).toEqual([]);
        expect(LANE_PARAMETERS.synthA).toEqual(expect.arrayContaining(['filterCutoff', 'filterResonance', 'decay', 'macroTimbre']));
        expect(LANE_PARAMETERS.synthA).not.toContain('delayMix');
    });

    it('ships validators that import nothing (no ajv at runtime)', () => {
        const code = readFileSync(resolve(ROOT, 'src/agent/coproducer/generated/toolValidators.js'), 'utf8');
        expect(code).not.toMatch(/\brequire\(/);
        expect(code).not.toMatch(/^\s*import\s/m);
        expect(Object.keys(TOOL_INPUT_SCHEMAS)).toHaveLength(7);
    });
});

describe('validation: a bad input is an error result, never a throw, and changes nothing', () => {
    const cases: Array<[string, string, unknown, RegExp]> = [
        ['unknown tool', 'play_song', {}, /unknown tool "play_song"/],
        ['note name off the pattern', 'edit_pattern', { track: 'synthA', slot: 0, edits: [{ step: 0, action: 'set', note: 'H2' }] }, /edits\[0\]\.note must match pattern/],
        ['unknown field', 'edit_pattern', { track: 'synthA', slot: 0, edits: [], color: 'red' }, /unknown field "color"/],
        ['unknown track', 'set_params', { track: 'lead', knobs: { volume: 1 } }, /track must be one of: synthA/],
        ['lane value over 127', 'set_params', { track: 'synthA', automation: [{ parameter: 'filterCutoff', steps: [200] }] }, /must be <= 127/],
        ['truncated (streamed) input', 'edit_pattern', { track: 'synthA' }, /must have required property 'slot'/],
        ['not an object', 'arrange', 'place everything', /must be object/],
        ['an invalid AI song', 'import_song', { ...minimal, globals: { tempo: 900 } }, /must be <= 300/],
    ];
    it.each(cases)('%s', async (_name, tool, input, message) => {
        const host = hostFor(songOf(minimal));
        const before = host.song;
        const result = await run(host, tool, input);
        expect(result.isError).toBe(true);
        expect(result.text).toMatch(message);
        expect(host.song).toBe(before);
        expect(host.commits).toHaveLength(0);
    });

    it('turns a handler that throws into an error result', async () => {
        const host = hostFor(songOf(minimal));
        host.render = () => Promise.reject(new Error('no audio engine'));
        const result = await run(host, 'render_and_measure', {});
        expect(result.isError).toBe(true);
        expect(result.body.error).toBe('render_and_measure failed: no audio engine');
    });
});

describe('get_song', () => {
    it('returns the song as AI song JSON, the knobs and what the format leaves out', async () => {
        const host = hostFor(songOf(full));
        const { body, isError } = await run<SongBody>(host, 'get_song', {});
        expect(isError).toBe(false);
        expect(validateAISong(body.song)).toBe(true);
        expect(body.song.tracks?.synthA?.notes[0]).toEqual({ step: 0, note: 'C3', velocity: 0.95, accent: true });
        expect(body.knobs.synthA).toMatchObject({ waveform: '303-saw', filterCutoff: 2200, filterResonance: 14 });
        expect(body.knobs.bass2).toMatchObject({ waveform: '303-sqr', filterCutoff: 900, accent: 0.7 });
        expect(body.knobs.kick).toEqual({ pitch: 60, decay: 0.4, tone: 0.6, volume: 1 });
        expect(body.knobs.sampler).toHaveLength(8);
        expect(body.activeSlots).toMatchObject({ synthA: 0, sampler: 0 });
        expect(body.notExported).toEqual([]);
    });

    it('lists the arrangement clips of a song-mode song', async () => {
        const { body } = await run<SongBody>(hostFor(songOf(songMode)), 'get_song', {});
        expect(body.arrangement.clips[0]).toMatchObject({ id: expect.any(String) as unknown, track: 'synthA', pattern: 'slot0' });
        expect(body.song.patterns?.slot1).toBeDefined();
    });
});

describe('edit_pattern', () => {
    it('sets, updates and clears steps on the active slot, live pattern included, as one commit', async () => {
        const host = hostFor(songOf(minimal));
        const { body, isError } = await run(host, 'edit_pattern', {
            track: 'synthA', slot: 0, edits: [
                { step: 1, action: 'set', note: 'G2', accent: true },
                { step: 0, action: 'update', velocity: 0.5 },
                { step: 3, action: 'clear' },
            ],
        });
        expect(isError).toBe(false);
        expect(host.commits.map((c) => c.label)).toEqual(['Co-producer: edit_pattern synthA slot 0']);
        expect(body.patterns).toEqual([{
            track: 'synthA', slot: 0, changedSteps: 3, steps: [
                { step: 0, before: 'C2 v0.9 accent', after: 'C2 v0.5 accent' },
                { step: 1, before: null, after: 'G2 v0.8 accent' },
                { step: 3, before: 'C2 v0.8', after: null },
            ],
        }]);
        const live = host.song.pattern.partA.steps;
        expect(live[1]).toEqual({ note: 'G2', velocity: 0.8, length: 1, timbre: 1 });
        expect((host.song.trackStorage.partA as PartSequence[])[0].steps).toEqual(live);
    });

    it('writes drum hits and clears the steps a long note covers', async () => {
        const host = hostFor(songOf(minimal));
        await run(host, 'edit_pattern', { track: 'snare', slot: 0, edits: [{ step: 4, action: 'set', velocity: 0.6 }] });
        expect(host.song.pattern.snare.steps[4]).toEqual({ note: 'D2', velocity: 0.6, length: 1, timbre: 0.5 });
        await run(host, 'edit_pattern', { track: 'synthA', slot: 0, edits: [{ step: 0, action: 'update', length: 4 }] });
        expect(host.song.pattern.partA.steps.slice(0, 4).map((n) => n?.note ?? null)).toEqual(['C2', null, null, null]);
    });

    it('edits another slot without touching the live pattern', async () => {
        const host = hostFor(songOf(minimal));
        const live = host.song.pattern;
        await run(host, 'edit_pattern', { track: 'bass2', slot: 3, edits: [{ step: 0, action: 'set', note: 'C1' }] });
        expect(host.song.pattern).toBe(live);
        expect(((host.song.trackStorage.bass2 as PartSequence[])[3]).steps[0]?.note).toBe('C1');
    });

    it('needs a bank on the sampler and refuses steps past the pattern', async () => {
        const host = hostFor(songOf(minimal));
        expect((await run(host, 'edit_pattern', { track: 'sampler', slot: 0, edits: [{ step: 0, action: 'set', note: 'C4' }] })).body.error)
            .toBe('sampler edits need a bank (0–7)');
        expect((await run(host, 'edit_pattern', { track: 'synthA', slot: 0, edits: [{ step: 40, action: 'set', note: 'C4' }] })).body.error)
            .toMatch(/past the end of the pattern \(the song has 32 steps/);
        expect((await run(host, 'edit_pattern', { track: 'synthA', slot: 0, edits: [{ step: 2, action: 'update', velocity: 1 }] })).body.error)
            .toBe('edits[0]: no note on step 2 to update (use set)');
        const ok = await run(host, 'edit_pattern', { track: 'sampler', slot: 0, bank: 2, edits: [{ step: 0, action: 'set', note: 'C4' }] });
        expect(ok.isError).toBe(false);
        expect(host.song.pattern.sampler[2].steps[0]).toEqual({ note: 'C4', velocity: 0.8, length: 1 });
        expect(host.commits).toHaveLength(1);
    });

    it('says when nothing changed and commits nothing', async () => {
        const host = hostFor(songOf(minimal));
        const { body } = await run(host, 'edit_pattern', { track: 'synthA', slot: 0, edits: [{ step: 2, action: 'clear' }] });
        expect(body).toEqual({ changed: false });
        expect(host.commits).toHaveLength(0);
    });
});

describe('set_params', () => {
    it('turns knobs in their own units, BASS 2 names included', async () => {
        const host = hostFor(songOf(full));
        const { body } = await run(host, 'set_params', { track: 'bass2', knobs: { filterCutoff: 600, accent: 0.9 } });
        expect(host.song.params.bass2).toMatchObject({ cutoff: 600, accent: 0.9 });
        expect(body.knobs).toEqual([
            { track: 'bass2', knob: 'cutoff', from: 900, to: 600 },
            { track: 'bass2', knob: 'accent', from: 0.7, to: 0.9 },
        ]);
    });

    it('refuses a knob out of range or on the wrong track', async () => {
        const host = hostFor(songOf(full));
        expect((await run(host, 'set_params', { track: 'synthA', knobs: { filterCutoff: 20000 } })).body.error)
            .toBe('synthA.filterCutoff must be 20–8000 Hz, got 20000');
        expect((await run(host, 'set_params', { track: 'kick', knobs: { noise: 2000 } })).body.error)
            .toMatch(/^noise is not a kick knob\. kick knobs: pitch, decay, tone, volume$/);
        expect((await run(host, 'set_params', { track: 'synthA', knobs: { macroTimbre: 0.2 } })).body.error)
            .toMatch(/macro knobs need a macro-\* waveform on synthA/);
        expect(host.commits).toHaveLength(0);
    });

    it('sets macro knobs once the part is on a macro model', async () => {
        const host = hostFor(songOf(full));
        const { isError } = await run(host, 'set_params', { track: 'synthB', knobs: { waveform: 'macro-va', macroTimbre: 0.2, macroFmMod: -0.5 } });
        expect(isError).toBe(false);
        expect(host.song.params.synthB.waveform).toBe('macro-va');
        expect(host.song.params.synthB.macro).toEqual({ timbre: 0.2, fmMod: -0.5 });
    });

    it('draws a lane that plays, replacing the one on that parameter, and refuses one that does not', async () => {
        const host = hostFor(songOf(full));
        const steps = Array.from({ length: 32 }, (_, i) => (i % 8 === 0 ? 127 - i * 3 : null));
        const { body } = await run(host, 'set_params', { track: 'synthA', automation: [{ parameter: 'filterCutoff', steps, interpolation: 'linear' }] });
        expect(body.lanes).toEqual({ changed: ['synthA.filterCutoff'] });
        const lanes = host.song.automationLanes!.filter((l) => l.target === 'synthA' && l.parameter === 'filterCutoff');
        expect(lanes).toHaveLength(1);
        expect(lanes[0].points).toEqual([0, 8, 16, 24].map((step) => ({ step, value: (127 - step * 3) / 127 })));

        expect((await run(host, 'set_params', { track: 'kick', automation: [{ parameter: 'decay', steps }] })).body.error)
            .toBe('automation[0]: the live scheduler plays no kick lanes');
        expect((await run(host, 'set_params', { track: 'synthA', automation: [{ parameter: 'filterCutoff', steps: [1, 2] }] })).body.error)
            .toBe('automation[0].steps has 2 values; the song has 32 steps per pattern');
        const knobNote = await run(host, 'set_params', { track: 'synthA', knobs: { filterCutoff: 1000 } });
        expect(knobNote.body.notes).toEqual(['synthA.filterCutoff also has an automation lane; the lane wins on the steps it has values for']);
        const cleared = await run(host, 'set_params', { track: 'synthA', clear_automation: ['filterCutoff'] });
        expect(cleared.body.lanes).toEqual({ removed: ['synthA.filterCutoff'] });
    });

    it('sets tempo and swing without a track', async () => {
        const host = hostFor(songOf(minimal));
        const { body } = await run(host, 'set_params', { tempo: 124, swing: 58 });
        expect(body.globals).toEqual([
            { field: 'tempo', from: 128, to: 124 },
            { field: 'swing', from: 50, to: 58 },
        ]);
        expect(host.commits.map((c) => c.label)).toEqual(['Co-producer: set_params song']);
    });

    it('changes per-slot 303 knobs on one slot, or on every slot', async () => {
        const host = hostFor(songOf(songMode));
        const storage = host.song.trackParamStorage!.synthA;
        expect(storage[1]?.waveform).toBe('303-sqr');
        await run(host, 'set_params', { track: 'synthA', slot: 1, knobs: { filterResonance: 4 } });
        expect(host.song.trackParamStorage!.synthA[1]?.filterResonance).toBe(4);
        expect(host.song.trackParamStorage!.synthA[0]?.filterResonance).toBe(12);
        expect(host.song.params.synthA.filterResonance).toBe(12); // slot 0 is the active one
        await run(host, 'set_params', { track: 'synthA', knobs: { volume: 0.5 } });
        expect(host.song.params.synthA.volume).toBe(0.5);
        expect(host.song.trackParamStorage!.synthA.filter(Boolean).every((p) => p!.volume === 0.5)).toBe(true);
        expect((await run(host, 'set_params', { track: 'synthB', slot: 1, knobs: { volume: 0.5 } })).body.error)
            .toMatch(/^synthB has no per-slot knobs/);
    });
});

describe('arrange', () => {
    it('places a slot on measures and clears others, reporting the rows that changed', async () => {
        const host = hostFor(songOf(songMode));
        const before = await rowsOf(host);
        const { body, isError } = await run(host, 'arrange', {
            ops: [
                { op: 'place', track: 'bass2', slot: 0, start_measure: 2, measures: 2 },
                { op: 'clear', track: 'kick', start_measure: 0 },
            ],
        });
        expect(isError).toBe(false);
        expect(body.measures).toEqual({ changed: [0, 2, 3], from: before.length, to: before.length });
        const after = await rowsOf(host);
        expect(after[0]).toEqual({ closedHat: 'slot0' });
        expect(after[2].bass2).toBe('slot0');
        expect(host.commits.map((c) => c.label)).toEqual(['Co-producer: arrange (2 ops)']);
    });

    it('trims a clip by id and refuses an unknown one', async () => {
        const host = hostFor(songOf(songMode));
        const clip = (await run<SongBody>(host, 'get_song', {})).body.arrangement.clips[0];
        expect((await run(host, 'arrange', { ops: [{ op: 'trim', clip_id: clip.id, length_steps: 8 }] })).isError).toBe(false);
        expect(host.song.arrangement!.clips.find((c) => c.id === clip.id)!.lengthSteps).toBe(8);
        expect((await run(host, 'arrange', { ops: [{ op: 'remove_clip', clip_id: 'clip-999' }] })).body.error)
            .toBe('ops[0] (remove_clip): no clip "clip-999" (get_song lists arrangement.clips)');
    });
});

describe('import_song', () => {
    it('loads a strict-valid song as one step and reports the lanes the render cannot play', async () => {
        const host = hostFor(songOf(minimal));
        const { body, isError } = await run(host, 'import_song', full);
        expect(isError).toBe(false);
        expect(host.loads).toEqual(['Co-producer: import_song "Full Ingest Reference"']);
        expect(body).toMatchObject({ imported: 'Full Ingest Reference', tempo: 96, stepCount: 32, unrenderedLanes: [] });
    });

    it('rejects a song the strict importer warns about and loads nothing', async () => {
        const host = hostFor(songOf(minimal));
        const kickLane = { target: 'kick', parameter: 'decay', steps: Array.from({ length: 16 }, () => 64) };
        const { body, isError } = await run(host, 'import_song', { ...minimal, automation: [kickLane] });
        expect(isError).toBe(true);
        expect(body.errors).toEqual(['strict: automation[0] kick.decay is saved but never plays: the scheduler routes no kick lanes.']);
        expect(host.loads).toEqual([]);
    });

    it('names the lanes the offline render cannot play', () => {
        const song = songOf(full);
        song.params.synthA = { ...song.params.synthA, waveform: 'macro-va' };
        expect(unrenderedLanes(song)).toEqual([
            { lane: 'synthA.filterCutoff', reason: 'macro voices render offline without filter automation' },
        ]);
    });
});

describe('render_and_measure and export', () => {
    it('measures the master and every stem', async () => {
        const { body, isError } = await run<MeasureBody>(hostFor(songOf(minimal)), 'render_and_measure', { bars: true });
        expect(isError).toBe(false);
        expect(body.seconds).toBe(2);
        expect(body.master.peakDbfs).toBeCloseTo(-12, 0);
        expect(body.master.crestDb).toBeCloseTo(3, 0); // a sine's peak sits 3 dB over its RMS
        expect(body.master.centroidHz).toBeGreaterThan(300);
        expect(body.master.integratedLufs).toEqual(expect.any(Number));
        expect(body.master.bars.length).toBeGreaterThan(0);
        expect(body.stems.synthA.rmsDbfs).toBeLessThan(body.master.rmsDbfs);
        expect(body.silencedTracks).toEqual(['synthB']);
        expect(body.automation).toEqual({ applied: ['synthA.filterCutoff'], notRendered: [] });
    });

    it('offers a file and says what it is', async () => {
        const { body } = await run(hostFor(songOf(minimal)), 'export', { format: 'mid' });
        expect(body).toEqual({ offered: 'song.mid', bytes: 6, warnings: [] });
    });
});

describe('every edit keeps the song exportable', () => {
    it('get_song after a run of edits still validates and round-trips through the strict importer', async () => {
        const host = hostFor(songOf(songMode));
        await run(host, 'edit_pattern', { track: 'synthA', slot: 2, edits: [{ step: 5, action: 'set', note: 'D3', slide: true }] });
        await run(host, 'set_params', { track: 'synthA', automation: [{ parameter: 'filterResonance', steps: Array.from({ length: 16 }, (_, i) => i * 8) }] });
        await run(host, 'arrange', { ops: [{ op: 'place', track: 'synthB', slot: 4, start_measure: 1 }] });
        const { body } = await run<SongBody>(host, 'get_song', {});
        expect(validateAISong(body.song), JSON.stringify(validateAISong.errors)).toBe(true);
        expect(new AISongImporter().convert(body.song, { strict: true }).success).toBe(true);
    });
});
