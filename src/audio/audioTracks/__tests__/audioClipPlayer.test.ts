/**
 * The live audio clip path end to end, in Node: `AudioClipPlayer` (main
 * thread) drives the real `audio-clip-processor` worklet class block by block,
 * through SAB rings and through posted pages, and the result is compared with
 * the media sample by sample — and with the offline render (null test).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { AUDIO_TRACK_KEYS } from '@/constants';
import type { Arrangement, AudioClip } from '@/types/song';
import { DECLICK_FRAMES, SabClipRing, ringBytes } from '@/shared/rt/audioClipVoice';
import { AudioClipPlayer, type MediaReader } from '../AudioClipPlayer';
import { renderAudioTracksOffline, songStepFrame } from '../renderOffline';
import type { StepClock } from '../clipTiming';

const RATE = 48000;
const STEP = 6000; // one 16th at 120 BPM, 48 kHz
const LOOKAHEAD = 1920; // the clock posts a step 40 ms before it sounds
const MEDIA_ID = 'a'.repeat(64);

type ProcessorLike = {
    port: { onmessage: ((e: { data: unknown }) => void) | null; postMessage: (m: unknown) => void };
    process: (inputs: Float32Array[][], outputs: Float32Array[][]) => boolean;
};
let Processor: new (options: { processorOptions: unknown }) => ProcessorLike;

beforeAll(async () => {
    const g = globalThis as Record<string, unknown>;
    g.AudioWorkletProcessor = class {
        port = { onmessage: null, postMessage: () => {} };
    };
    g.registerProcessor = (_name: string, cls: typeof Processor) => {
        Processor = cls;
    };
    g.sampleRate = RATE;
    g.currentFrame = 0;
    await import('@/audio-worklets/audio-clip-processor');
});

function sourceOf(frames: number): Float32Array[] {
    const l = Float32Array.from({ length: frames }, (_, i) => Math.sin(i / 7) * 0.5);
    const r = Float32Array.from({ length: frames }, (_, i) => Math.cos(i / 11) * 0.5);
    return [l, r];
}

function audioClip(partial: Partial<AudioClip>): AudioClip {
    return {
        kind: 'audio', id: 'clip-1', track: 'audio-1', mediaId: MEDIA_ID,
        startStep: 4, lengthSteps: 8, offsetFrames: 0, gainDb: 0, warp: 'off', ...partial,
    };
}

interface RigOptions {
    sab?: boolean;
    media?: Float32Array[];
    mediaRate?: number;
    /** Hold page reads back until `release()` (a slow disk). */
    slow?: boolean;
}

function rig(options: RigOptions = {}) {
    const voices = 8;
    const capacity = 32768;
    const media = options.media ?? sourceOf(STEP * 8);
    const mediaRate = options.mediaRate ?? RATE;
    const buffer = options.sab === false ? null : new SharedArrayBuffer(ringBytes(capacity) * voices);
    const proc = new Processor({ processorOptions: { voices, tracks: 8, capacity, sab: buffer } });
    const rings = buffer
        ? Array.from({ length: voices }, (_, v) => new SabClipRing(buffer, v * ringBytes(capacity), capacity))
        : null;
    const held: (() => void)[] = [];
    const reader: MediaReader = {
        readFrames: (_id, from, count) => {
            const page = media.map((ch) => ch.slice(from, from + count));
            if (!options.slow) return Promise.resolve(page);
            return new Promise((resolve) => held.push(() => resolve(page)));
        },
    };
    let frame = 0;
    const total = STEP * 40;
    const out = [new Float32Array(total), new Float32Array(total)];
    const outputs = Array.from({ length: 8 }, () => [new Float32Array(128), new Float32Array(128)]);
    const posted: { t: string }[] = [];
    const player = new AudioClipPlayer({
        port: {
            postMessage: (m) => {
                posted.push(m as { t: string });
                proc.port.onmessage?.({ data: m });
            },
        },
        reader,
        contextRate: RATE,
        now: () => frame,
        voices,
        capacity,
        rings,
        tracks: AUDIO_TRACK_KEYS,
        media: () => ({ sampleRate: mediaRate, frames: media[0].length }),
    });
    // Pump like the host's timer, then let resolved reads land (held ones stay held).
    const settle = async () => {
        for (let i = 0; i < 4; i++) {
            void player.pump();
            for (let k = 0; k < 4; k++) await Promise.resolve();
        }
    };
    const renderTo = async (target: number) => {
        while (frame + 128 <= target) {
            (globalThis as Record<string, unknown>).currentFrame = frame;
            proc.process([], outputs);
            out[0].set(outputs[0][0], frame);
            out[1].set(outputs[0][1], frame);
            frame += 128;
            if (frame % 2048 === 0) await settle(); // the host's pump timer
        }
    };
    /** Play song steps `from`..`to` (exclusive), the clock posting each one ahead. */
    const play = async (arrangement: Arrangement, from: number, to: number, clock: StepClock = { tempo: 120, swing: 0 }, base = STEP * 2) => {
        let absStep = 0;
        for (let pos = from; pos < to; pos++, absStep++) {
            const at = base + songStepFrame(pos - from, clock, RATE);
            await renderTo(at - LOOKAHEAD);
            player.step({ arrangement, pos, frame: at, absStep, clock, loopLength: 64 });
            await settle();
        }
        await renderTo(base + songStepFrame(to - from, clock, RATE) + 4096);
    };
    return { player, out, play, renderTo, media, posted, release: () => held.splice(0).forEach((fn) => fn()), get frame() { return frame; } };
}

const arrangementOf = (...clips: AudioClip[]): Arrangement => ({ clips, lengthSteps: 64 });

describe('AudioClipPlayer + audio-clip-processor', () => {
    it.each([['SAB rings', true], ['posted pages', false]])('plays a clip sample-exact on its step (%s)', async (_n, sab) => {
        const r = rig({ sab });
        await r.play(arrangementOf(audioClip({})), 0, 14);
        const start = STEP * 2 + 4 * STEP;
        for (let i = 0; i < r.media[0].length; i += 97) {
            expect(r.out[0][start + i]).toBe(r.media[0][i]);
            expect(r.out[1][start + i]).toBe(r.media[1][i]);
        }
        expect(r.out[0][start - 1]).toBe(0);
        expect(r.out[0][start + r.media[0].length]).toBe(0);
    });

    it('starts a seek mid-clip at the matching source frame, with a declick', async () => {
        const r = rig();
        // PLAY from song step 6: the clip started at 4, so it is 2 steps in.
        await r.play(arrangementOf(audioClip({})), 6, 14);
        const start = STEP * 2;
        expect(r.out[0][start + DECLICK_FRAMES + 10]).toBe(r.media[0][2 * STEP + DECLICK_FRAMES + 10]);
        expect(Math.abs(r.out[0][start])).toBeLessThan(Math.abs(r.media[0][2 * STEP]) / 8 + 1e-9);
    });

    it('a head-trimmed clip plays from its offset; the cut edge is declicked', async () => {
        const r = rig();
        await r.play(arrangementOf(audioClip({ startStep: 6, lengthSteps: 6, offsetSteps: 2 })), 0, 14);
        const start = STEP * 2 + 6 * STEP;
        expect(r.out[0][start + 200]).toBe(r.media[0][2 * STEP + 200]);
        expect(Math.abs(r.out[0][start])).toBeLessThan(0.02);
    });

    it('keeps a clip on the grid when a page arrives late', async () => {
        const r = rig({ slow: true });
        const arrangement = arrangementOf(audioClip({ startStep: 0 }));
        // No prefetch: the clip starts on the first step, and its first page is held.
        r.player.step({ arrangement, pos: 0, frame: 4096, absStep: 0, clock: { tempo: 120, swing: 0 }, loopLength: 64 });
        await r.renderTo(4096 + 1000);
        r.release();
        for (let k = 0; k < 4; k++) await Promise.resolve();
        await r.renderTo(4096 + 4000);
        r.release();
        // Late frames were silence; everything after lines up with the source.
        expect(r.out[0][4096 + 500]).toBe(0);
        expect(r.out[0][4096 + 3000]).toBe(r.media[0][3000]);
    });

    it('plays media at another rate through the resampler', async () => {
        const half = sourceOf(STEP * 4).map((ch) => ch.slice());
        const r = rig({ media: half, mediaRate: RATE / 2 });
        await r.play(arrangementOf(audioClip({})), 0, 14);
        const start = STEP * 2 + 4 * STEP;
        expect(r.out[0][start + 1000]).toBeCloseTo(half[0][500], 6);
        expect(r.out[0][start + 1001]).toBeCloseTo((half[0][500] + half[0][501]) / 2, 6);
    });

    it('follows a tempo change: the clip keeps playing past its old right edge', async () => {
        const r = rig({ media: sourceOf(STEP * 16) });
        const arrangement = arrangementOf(audioClip({ lengthSteps: 8 }));
        const fast = { tempo: 120, swing: 0 };
        await r.play(arrangement, 0, 8, fast);
        // From step 8 on the song runs at 60 BPM: steps are twice as long.
        const slow = { tempo: 60, swing: 0 };
        const base = STEP * 2 + 8 * STEP;
        for (let pos = 8; pos < 13; pos++) {
            const at = base + (pos - 8) * STEP * 2;
            await r.renderTo(at - LOOKAHEAD);
            r.player.step({ arrangement, pos, frame: at, absStep: pos, clock: slow, loopLength: 64 });
        }
        await r.renderTo(base + 6 * STEP * 2);
        const start = STEP * 2 + 4 * STEP;
        // At 120 BPM the clip would have ended at start + 8 steps; now it runs 4 steps × 2 more.
        const late = start + 8 * STEP + 2000;
        expect(r.out[0][late]).toBe(r.media[0][late - start]);
        expect(r.out[0][start + 4 * STEP + 8 * STEP + 100]).toBe(0);
    });

    it('stops everything on a transport stop, declicked', async () => {
        const r = rig();
        const arrangement = arrangementOf(audioClip({ startStep: 0 }));
        await r.play(arrangement, 0, 2);
        const stopAt = r.frame;
        r.player.stopAll(stopAt);
        await r.renderTo(stopAt + 1024);
        expect(r.out[0].subarray(stopAt + DECLICK_FRAMES + 1, stopAt + 1024).every((v) => v === 0)).toBe(true);
        expect(r.player.activeVoices()).toEqual([]);
    });

    it('keeps a voice through an equal clip rebuilt by a load, restarts it on a real edit', async () => {
        const r = rig();
        const clip = audioClip({ startStep: 0, lengthSteps: 12 });
        await r.play(arrangementOf(clip), 0, 2);
        const kinds = () => r.posted.splice(0).map((m) => m.t).filter((t) => t !== 'chunk');
        kinds();
        // A peer edit elsewhere: the projection rebuilds every clip object.
        r.player.step({ arrangement: arrangementOf({ ...clip }), pos: 2, frame: STEP * 2 + 2 * STEP, absStep: 2, clock: { tempo: 120, swing: 0 }, loopLength: 64 });
        expect(kinds()).toEqual([]);
        r.player.step({ arrangement: arrangementOf({ ...clip, gainDb: -6 }), pos: 3, frame: STEP * 2 + 3 * STEP, absStep: 3, clock: { tempo: 120, swing: 0 }, loopLength: 64 });
        expect(kinds()).toEqual(['end', 'prepare', 'arm']);
        expect(r.player.activeVoices()).toEqual([{ clipId: 'clip-1', state: 'playing' }]);
    });

    it('prepares a voice before the clip starts, across the loop point too', () => {
        const r = rig();
        const arrangement = arrangementOf(audioClip({ startStep: 2 }));
        r.player.step({ arrangement, pos: 62, frame: 0, absStep: 0, clock: { tempo: 120, swing: 0 }, loopLength: 64 });
        expect(r.player.activeVoices()).toEqual([{ clipId: 'clip-1', state: 'prepared' }]);
    });

    it('null-tests against the offline render', async () => {
        const r = rig();
        const clips = [
            audioClip({ id: 'clip-1', startStep: 4, lengthSteps: 4, gainDb: -6, fadeInFrames: 500 }),
            audioClip({ id: 'clip-2', startStep: 8, lengthSteps: 4, offsetSteps: 4, fadeOutFrames: 3000 }),
        ];
        const clock = { tempo: 120, swing: 0 };
        await r.play(arrangementOf(...clips), 0, 14, clock, 0);
        const offline = await renderAudioTracksOffline({
            arrangement: arrangementOf(...clips),
            tracks: [{ id: 'audio-1', name: 'Audio 1', gainDb: 0, pan: 0 }],
            clock,
            sampleRate: RATE,
            frames: STEP * 14,
            loadMedia: () => Promise.resolve({ sampleRate: RATE, frames: r.media[0].length, channels: r.media }),
        });
        const [track] = offline.tracks;
        let maxDiff = 0;
        for (let i = 0; i < STEP * 14; i++) {
            maxDiff = Math.max(maxDiff, Math.abs(track.left[i] - r.out[0][i]), Math.abs(track.right[i] - r.out[1][i]));
        }
        expect(maxDiff).toBe(0);
        // And it is not silence.
        expect(Math.max(...track.left.subarray(STEP * 5, STEP * 6))).toBeGreaterThan(0.1);
    });
});
