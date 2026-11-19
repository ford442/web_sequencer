/**
 * The arrangement's waveform scene (#1629 P2): one bar per pixel column of a
 * clip in view, taken from the source frames the column plays and scaled by
 * the clip's gain and fades.
 */
import { describe, expect, it } from 'vitest';
import type { AudioClip, MediaRef } from '@/types/song';
import { buildPeaks, type PeakPyramid } from '@/audio/media/peaks';
import { QUAD_FLOATS } from '../../piano-roll/render/rollScene';
import { DEFAULT_WAVEFORM_THEME, buildWaveformScene, type WaveformSceneInput } from '../waveformScene';

const MEDIA = 'c'.repeat(64);
const RATE = 48000;
/** 120 BPM: a step is 0.125 s = 6000 frames. */
const CLOCK = { tempo: 120, swing: 0 };
const FRAMES_PER_STEP = 6000;

/** One second of silence, then one second of a ±`level` square at Nyquist, then silence. */
function steppedAudio(level: number): Float32Array {
    const out = new Float32Array(RATE * 3);
    for (let i = RATE; i < RATE * 2; i++) out[i] = i & 1 ? -level : level;
    return out;
}

const clip = (patch: Partial<AudioClip> = {}): AudioClip => ({
    kind: 'audio', id: 'clip-1', track: 'audio-1', mediaId: MEDIA, startStep: 0, lengthSteps: 24,
    offsetFrames: 0, gainDb: 0, warp: 'off', ...patch,
});

interface Quad { x: number; y: number; w: number; h: number; rgba: number[] }

function quads(scene: { quads: Float32Array; count: number }): Quad[] {
    const out: Quad[] = [];
    for (let i = 0; i < scene.count; i++) {
        const d = scene.quads.subarray(i * QUAD_FLOATS, (i + 1) * QUAD_FLOATS);
        out.push({ x: d[0], y: d[1], w: d[2], h: d[3], rgba: Array.from(d.subarray(4, 8)) });
    }
    return out;
}

const same = (a: number[], b: readonly number[]) => a.every((v, i) => Math.abs(v - b[i]) < 1e-6);

function scene(clips: AudioClip[], patch: Partial<WaveformSceneInput> = {}, peaks: PeakPyramid | null = buildPeaks([steppedAudio(0.5)])) {
    const media: Record<string, MediaRef> = { [MEDIA]: { name: 'a.wav', sampleRate: RATE, channels: 1, frames: RATE * 3 } };
    return quads(buildWaveformScene({
        width: 400, height: 68, scrollLeft: 0, pxPerStep: 4, rowHeight: 34, insetTop: 3, insetBottom: 4,
        tracks: ['audio-1', 'audio-2'], clips, media, peaks: () => peaks, clock: CLOCK, selectedId: null, ...patch,
    }));
}

const bars = (q: Quad[], color: readonly number[] = DEFAULT_WAVEFORM_THEME.wave) => q.filter((b) => same(b.rgba, color));
const barAt = (q: Quad[], x: number, color?: readonly number[]) => bars(q, color).find((b) => b.x === x);

/**
 * The loud columns are `[from, to)`, give or take the column at each edge: a
 * peak read may widen by up to one bucket (under a pixel here), never narrow.
 */
function expectLoud(q: Quad[], from: number, to: number, color?: readonly number[]) {
    const loud = new Set(bars(q, color).filter((b) => b.h > 2).map((b) => b.x));
    for (let x = from; x < to; x++) expect(loud.has(x), `column ${x} loud`).toBe(true);
    for (const x of loud) expect(x >= from - 1 && x <= to, `column ${x} quiet`).toBe(true);
}

describe('buildWaveformScene', () => {
    it('draws each pixel column from the frames it plays', () => {
        // 4 px per step = 1500 frames per px: audio is loud on px 32 … 63 (steps 8 … 16).
        const q = scene([clip()]);
        expectLoud(q, 32, 64);
        // Half scale on a 27 px clip: the bar spans 0.5 · 12.5 px either side of the middle (3 + 13.5).
        const bar = barAt(q, 40)!;
        expect(bar.y).toBeCloseTo(16.5 - 6.25, 3);
        expect(bar.h).toBeCloseTo(12.5, 3);
        // The silent part is a 1 px bar on the zero line.
        expect(barAt(q, 10)!.h).toBe(1);
    });

    it('follows the slip, the head trim, the row and the scroll', () => {
        // offsetFrames one step in: the loud second starts a step earlier.
        expectLoud(scene([clip({ offsetFrames: FRAMES_PER_STEP })]), 28, 60);
        // A head trim moves the edge, not the audio.
        expectLoud(scene([clip({ startStep: 4, lengthSteps: 20, offsetSteps: 4 })]), 32, 64);
        // The second row, scrolled 20 px.
        const second = scene([clip({ track: 'audio-2' })], { scrollLeft: 20 });
        expectLoud(second, 12, 44);
        expect(bars(second).every((b) => b.y >= 34 + 3)).toBe(true);
    });

    it('scales by the clip gain, and draws a column past full scale hot', () => {
        const quiet = barAt(scene([clip({ gainDb: -6.0206 })]), 40)!;
        expect(quiet.h).toBeCloseTo(0.25 * 12.5 * 2, 2);
        // Clipped at full scale: the bar spans the clip less its 1 px margin.
        const hot = scene([clip({ gainDb: 12 })]);
        expectLoud(hot, 32, 64, DEFAULT_WAVEFORM_THEME.hot);
        expect(barAt(hot, 40, DEFAULT_WAVEFORM_THEME.hot)).toMatchObject({ y: 4, h: 25 });
    });

    it('shapes the bars by the fades and shades above the ramps', () => {
        // A fade-in over the whole loud part: it rises across it.
        const q = scene([clip({ startStep: 8, lengthSteps: 8, offsetSteps: 8, fadeInFrames: RATE })]);
        const loud = bars(q).filter((b) => b.x >= 32 && b.x < 64).sort((a, b) => a.x - b.x);
        expect(loud[0].h).toBeLessThan(loud[15].h);
        expect(loud[15].h).toBeLessThan(loud[31].h);
        const shade = q.filter((b) => same(b.rgba, DEFAULT_WAVEFORM_THEME.fadeShade));
        expect(shade.length).toBe(32);
        expect(shade[0].h).toBeGreaterThan(shade[31].h);
        expect(q.filter((b) => same(b.rgba, DEFAULT_WAVEFORM_THEME.fadeLine)).length).toBe(32);
    });

    it('culls what is out of view and draws only the zero line while peaks load', () => {
        expect(scene([clip({ startStep: 200 })])).toEqual([]);
        expect(scene([clip({ track: 'audio-7' })])).toEqual([]);
        const loading = scene([clip()], {}, null);
        expect(loading).toHaveLength(1);
        expect(loading[0]).toMatchObject({ x: 0, w: 96, h: 1 });
        // A clip of media the song does not know is hatched by its block, not drawn.
        expect(scene([clip({ mediaId: 'd'.repeat(64) })])).toEqual([]);
    });

    it('highlights the selected clip', () => {
        expect(bars(scene([clip()], { selectedId: 'clip-1' }), DEFAULT_WAVEFORM_THEME.waveSelected).length).toBeGreaterThan(0);
    });
});
