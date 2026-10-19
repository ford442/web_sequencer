/**
 * The AI-song preview bounces the song's automation lanes (#1384).
 *
 * The full fixture's `synthA.filterCutoff` lane rises over bar 1 and falls over
 * bar 2. Live, `AutomationScheduler` plays it into the 303. Offline, the
 * preview renders synthA through the pattern renderer — this test records the
 * cutoff every synthA hit was rendered with and checks it follows the lane.
 *
 * Unit tests have no real `OfflineAudioContext`, so the stub below records
 * what the renderer schedules instead of producing samples. The spectral
 * golden for the 303 engines lives in `offlineAutomation.freeze.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fullSong from '../../../test-fixtures/ai-song/full.json';
import type { AISongData } from '../../importers/ai-song';
import { renderAISongPreview } from '../aiSongPreview';

vi.mock('../../audio/offline/compileOfflineGraph', () => ({
    bounceBuffersThroughOfflineGraph: (opts: { sampleRate: number }) =>
        Promise.resolve({
            buffer: { length: 1, numberOfChannels: 2, sampleRate: opts.sampleRate },
            report: { patchName: 'test', slots: [], engineVoices: [] },
        }),
}));

interface ParamEvent { kind: string; value: number; time: number }
class RecordingParam {
    value = 0;
    events: ParamEvent[] = [];
    private push(kind: string, value: number, time: number) {
        this.events.push({ kind, value, time });
        return this;
    }
    setValueAtTime(v: number, t: number) { return this.push('set', v, t); }
    linearRampToValueAtTime(v: number, t: number) { return this.push('linear', v, t); }
    exponentialRampToValueAtTime(v: number, t: number) { return this.push('exp', v, t); }
}

/** Adds the AudioNode methods to `target` in place, so later property writes stay visible. */
function node<T extends object>(target: T = {} as T) {
    return Object.assign(target, { connect: () => undefined, disconnect: () => undefined, start: () => undefined, stop: () => undefined });
}

/** One synth hit rendered by `renderSynthToBuffer`: which track, and its filter cutoff. */
interface Hit { track: number; cutoff: RecordingParam }

let hits: Hit[] = [];
const originalCtor = globalThis.OfflineAudioContext;
const originalOscillatorNode = globalThis.OscillatorNode;

/**
 * Each track's pattern render opens one stereo context before its per-hit mono
 * ones, so counting stereo contexts tells the tracks apart. synthA renders first.
 */
let track = -1;
function synthAHits(): Hit[] {
    return hits.filter((h) => h.track === 0);
}

class RecordingOfflineContext {
    readonly destination = node();
    readonly length: number;
    readonly sampleRate: number;
    readonly numberOfChannels: number;
    private hasOsc = false;
    constructor(channels: number, length: number, sampleRate: number) {
        this.numberOfChannels = channels;
        this.length = length;
        this.sampleRate = sampleRate;
        if (channels === 2) track += 1;
    }
    createBuffer(channels: number, length: number, sampleRate: number): AudioBuffer {
        const data = Array.from({ length: channels }, () => new Float32Array(length));
        return { length, sampleRate, numberOfChannels: channels, duration: length / sampleRate, getChannelData: (c: number) => data[c] } as unknown as AudioBuffer;
    }
    createOscillator() {
        this.hasOsc = true;
        return node({ type: 'sine', frequency: new RecordingParam() });
    }
    createBiquadFilter() {
        const filter = { type: 'lowpass', frequency: new RecordingParam(), Q: new RecordingParam() };
        if (this.hasOsc) hits.push({ track, cutoff: filter.frequency });
        return node(filter);
    }
    createGain() { return node({ gain: new RecordingParam() }); }
    createBufferSource() { return node({ buffer: null, loop: false, playbackRate: new RecordingParam() }); }
    startRendering() { return Promise.resolve(this.createBuffer(this.numberOfChannels, this.length, this.sampleRate)); }
}

const STEP_OF_SYNTH_A_NOTE = (fullSong as unknown as AISongData).tracks.synthA!.notes.map((n) => n.step);
const CUTOFF_LANE = (fullSong as unknown as AISongData).automation!.find(
    (lane) => lane.target === 'synthA' && lane.parameter === 'filterCutoff',
)!.steps as number[];

describe('AI song preview — automation lanes (#1384)', () => {
    beforeEach(() => {
        hits = [];
        track = -1;
        globalThis.OfflineAudioContext = RecordingOfflineContext as unknown as typeof OfflineAudioContext;
        // renderSynthToBuffer checks `instanceof OscillatorNode`; happy-dom has none.
        globalThis.OscillatorNode = class {} as unknown as typeof OscillatorNode;
    });
    afterEach(() => {
        globalThis.OfflineAudioContext = originalCtor;
        globalThis.OscillatorNode = originalOscillatorNode;
    });

    it('renders each synthA hit at the cutoff the lane holds on that step', async () => {
        await renderAISongPreview(fullSong as unknown as AISongData, { sampleRatePref: 44100 });

        const synthA = synthAHits();
        expect(synthA).toHaveLength(STEP_OF_SYNTH_A_NOTE.length);

        const startCutoffs = synthA.map((h) => h.cutoff.events[0].value);
        // Bar 1 rises with the lane, bar 2 falls with it.
        const bar1 = startCutoffs.filter((_, i) => STEP_OF_SYNTH_A_NOTE[i] <= 16);
        const bar2 = startCutoffs.filter((_, i) => STEP_OF_SYNTH_A_NOTE[i] >= 16);
        for (let i = 1; i < bar1.length; i++) expect(bar1[i]).toBeGreaterThan(bar1[i - 1]);
        for (let i = 1; i < bar2.length; i++) expect(bar2[i]).toBeLessThan(bar2[i - 1]);

        // And the value is the lane's, in the 303's Hz scale (Open303Manager: Hz / 8000).
        STEP_OF_SYNTH_A_NOTE.forEach((step, i) => {
            expect(startCutoffs[i]).toBeCloseTo((CUTOFF_LANE[step] / 127) * 8000, 3);
        });
    });

    it('moves the cutoff inside a held 303 note, one value per step like the live scheduler', async () => {
        await renderAISongPreview(fullSong as unknown as AISongData, { sampleRatePref: 44100 });
        const synthA = synthAHits();
        // The last note (step 28) is two steps long: steps 28 and 29 both land.
        const held = synthA[synthA.length - 1].cutoff.events.filter((e) => e.kind === 'set');
        expect(held.map((e) => e.value)).toEqual([
            (CUTOFF_LANE[28] / 127) * 8000,
            (CUTOFF_LANE[29] / 127) * 8000,
        ].map((v) => expect.closeTo(v, 3) as unknown as number));
        expect(held[1].time).toBeGreaterThan(held[0].time);
    });

    it('renders a song without lanes at the knob cutoff', async () => {
        const flat = { ...(fullSong as unknown as AISongData), automation: [] };
        await renderAISongPreview(flat, { sampleRatePref: 44100 });
        const synthA = synthAHits();
        expect(new Set(synthA.map((h) => h.cutoff.events[0].value))).toEqual(new Set([2200]));
    });
});
