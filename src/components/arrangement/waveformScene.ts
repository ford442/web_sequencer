/**
 * The arrangement's waveforms (#1629 D5) as a flat list of quads, drawn by the
 * piano roll's quad renderers (WebGPU, Canvas2D fallback), so what is on
 * screen does not depend on the backend and the scene is unit-tested
 * without either.
 *
 * The canvas covers the audio lanes in view: canvas x 0 is lane x
 * `scrollLeft`, canvas y 0 the top of the first audio lane. Every CSS pixel
 * column of a clip in view gets one bar: the min / max of the source frames
 * that column plays (`clipSourceFrameAt`, swing included), scaled by the clip
 * gain and its fades, as the voice scales the audio. A column louder than
 * full scale is drawn hot. A fade shades the part of the clip above its ramp
 * and draws the ramp. Quads are clipped to their clip and to the canvas.
 */
import type { AudioClip, AudioTrackKey, MediaRef } from '@/types/song';
import { peakRange, type PeakPyramid } from '@/audio/media/peaks';
import { clipSourceFrameAt, songStepSeconds, type StepClock } from '@/audio/audioTracks/clipTiming';
import { QuadWriter, type Rgba, type RollScene } from '../piano-roll/render/rollScene';
import type { Rect } from '../piano-roll/model/rollGeometry';

export interface WaveformTheme {
    wave: Rgba;
    waveSelected: Rgba;
    /** A column past full scale after clip gain. */
    hot: Rgba;
    /** The zero line, drawn while peaks load and through silence. */
    centre: Rgba;
    fadeShade: Rgba;
    fadeLine: Rgba;
}

export const DEFAULT_WAVEFORM_THEME: WaveformTheme = {
    wave: [0.18, 0.83, 0.75, 0.8],
    waveSelected: [0.6, 0.97, 0.9, 0.95],
    hot: [0.97, 0.44, 0.44, 0.95],
    centre: [0.18, 0.83, 0.75, 0.35],
    fadeShade: [0, 0, 0, 0.4],
    fadeLine: [1, 1, 1, 0.85],
};

export interface WaveformSceneInput {
    /** Canvas size, CSS pixels. */
    width: number;
    height: number;
    /** Lane x (pixels from song step 0) at canvas x 0. */
    scrollLeft: number;
    pxPerStep: number;
    rowHeight: number;
    /** Gap between a row's top and its clips' tops, and between their bottoms and the next row. */
    insetTop: number;
    insetBottom: number;
    /** Audio tracks in lane order: a clip is drawn in its track's row. */
    tracks: readonly AudioTrackKey[];
    clips: readonly AudioClip[];
    media: Readonly<Record<string, MediaRef>>;
    peaks: (mediaId: string) => PeakPyramid | null;
    clock: StepClock;
    selectedId: string | null;
    theme?: WaveformTheme;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Linear clip gain, as the voice applies it (−96 dB and below is silence). */
export function clipGainLinear(gainDb: number): number {
    return gainDb <= -96 ? 0 : Math.pow(10, gainDb / 20);
}

export function buildWaveformScene(input: WaveformSceneInput): RollScene {
    const theme = input.theme ?? DEFAULT_WAVEFORM_THEME;
    const { width, height, scrollLeft, pxPerStep, rowHeight, clock } = input;
    const out = new QuadWriter(1024);
    if (width <= 0 || height <= 0 || pxPerStep <= 0) return out.finish();
    const rows = new Map(input.tracks.map((t, i) => [t, i]));
    const range = new Float32Array(2);
    const clipHeight = rowHeight - input.insetTop - input.insetBottom;

    for (const clip of input.clips) {
        const row = rows.get(clip.track);
        const ref = input.media[clip.mediaId];
        // A clip of missing media is hatched by its block; nothing to draw.
        if (row === undefined || !ref || clipHeight <= 2) continue;
        const end = clip.startStep + clip.lengthSteps;
        const x0 = clip.startStep * pxPerStep - scrollLeft;
        const x1 = end * pxPerStep - scrollLeft;
        if (x1 <= 0 || x0 >= width) continue;
        const top = row * rowHeight + input.insetTop;
        if (top >= height) continue;
        const region: Rect = {
            x: Math.max(0, x0),
            y: top,
            w: Math.min(width, x1) - Math.max(0, x0),
            h: Math.min(clipHeight, height - top),
        };
        const mid = top + clipHeight / 2;
        const half = clipHeight / 2 - 1;
        out.push(region, region.x, Math.floor(mid), region.w, 1, theme.centre);

        const peaks = input.peaks(clip.mediaId);
        const color = clip.id === input.selectedId ? theme.waveSelected : theme.wave;
        const gain = clipGainLinear(clip.gainDb);
        const rate = ref.sampleRate;
        const startSec = songStepSeconds(clip.startStep, clock);
        const endSec = songStepSeconds(end, clock);
        const fadeIn = (clip.fadeInFrames ?? 0) / rate;
        const fadeOut = (clip.fadeOutFrames ?? 0) / rate;
        let lineY = -1;
        for (let c = Math.floor(region.x); c < Math.ceil(region.x + region.w); c++) {
            const a = Math.max(clip.startStep, (c + scrollLeft) / pxPerStep);
            const b = Math.min(end, (c + 1 + scrollLeft) / pxPerStep);
            if (b <= a) continue;
            const sa = songStepSeconds(a, clock);
            const sb = songStepSeconds(b, clock);
            const t = (sa + sb) / 2;
            const env = (fadeIn > 0 ? clamp01((t - startSec) / fadeIn) : 1)
                * (fadeOut > 0 ? clamp01((endSec - t) / fadeOut) : 1);

            const fa = clipSourceFrameAt(clip, a, clock, rate);
            const fb = clipSourceFrameAt(clip, b, clock, rate);
            if (peaks && peakRange(peaks, fa, fb, range)) {
                const k = gain * env;
                let lo = range[0] * k;
                let hi = range[1] * k;
                const hot = hi > 1 || lo < -1;
                if (hi > 1) hi = 1;
                if (lo < -1) lo = -1;
                const y = mid - hi * half;
                out.push(region, c, y, 1, Math.max(1, (hi - lo) * half), hot ? theme.hot : color);
            }

            // Fades: shade above the ramp, and the ramp itself joined column to column.
            if (env < 1) {
                const y = top + (1 - env) * clipHeight;
                out.push(region, c, top, 1, y - top, theme.fadeShade);
                const from = lineY < 0 ? y : lineY;
                out.push(region, c, Math.min(from, y) - 1, 1, Math.abs(y - from) + 2, theme.fadeLine);
                lineY = y;
            } else {
                lineY = -1;
            }
        }
    }
    return out.finish();
}
