/**
 * Clip editing math (#1629 P2): fades, gain, slip and splits, with the moves
 * and trims that were already there.
 */
import { describe, expect, it } from 'vitest';
import type { AudioClip, MediaRef, PatternClip } from '@/types/song';
import {
    clipDragPatch, clipDragPreview, fadeWidthsPx, keyboardSplitStep, splitStepNear, type ClipDragMode, type DragGrid,
} from '../clipDrag';

const MEDIA: MediaRef = { name: 'a.wav', sampleRate: 48000, channels: 2, frames: 48000 * 10 };
/** 120 BPM, 8 px per step: a step is 6000 frames, a pixel 750. */
const GRID: DragGrid = { pxPerStep: 8, snap: 4, clock: { tempo: 120, swing: 0 }, media: MEDIA };

const audio = (patch: Partial<AudioClip> = {}): AudioClip => ({
    kind: 'audio', id: 'clip-1', track: 'audio-1', mediaId: 'a'.repeat(64), startStep: 16, lengthSteps: 16,
    offsetFrames: 0, gainDb: 0, warp: 'off', ...patch,
});
const pattern: PatternClip = { id: 'clip-2', track: 'kick', patternSlot: 0, startStep: 0, lengthSteps: 16, loop: true };

const drag = (mode: ClipDragMode, clip: AudioClip | PatternClip, dx: number, dy = 0, shift = false, grid = GRID) =>
    clipDragPreview({ mode, clip, originX: 100, originY: 50 }, 100 + dx, 50 + dy, shift, grid);

describe('clipDragPreview', () => {
    it('moves and trims on the grid (Shift: steps), the head trim keeping the content', () => {
        expect(drag('move', audio(), 30)).toMatchObject({ startStep: 20 });
        expect(drag('move', audio(), 30, 0, true)).toMatchObject({ startStep: 20 });
        expect(drag('move', audio(), 12, 0, true)).toMatchObject({ startStep: 18 });
        expect(drag('end', audio(), -40)).toMatchObject({ lengthSteps: 12 });
        expect(drag('start', audio(), 32)).toMatchObject({ startStep: 20, lengthSteps: 12, offsetSteps: 4 });
        // Not past the source start.
        expect(drag('start', audio(), -64)).toMatchObject({ startStep: 16, lengthSteps: 16, offsetSteps: 0 });
    });

    it('drags fades in source frames, never past the other fade', () => {
        expect(drag('fadeIn', audio(), 8)).toMatchObject({ fadeInFrames: 6000 });
        expect(drag('fadeOut', audio({ fadeOutFrames: 6000 }), -16)).toMatchObject({ fadeOutFrames: 18000 });
        expect(drag('fadeIn', audio({ fadeInFrames: 6000 }), -500)).toMatchObject({ fadeInFrames: 0 });
        // The clip is 96000 frames: a fade-in stops where the fade-out begins.
        expect(drag('fadeIn', audio({ fadeOutFrames: 30000 }), 4000)).toMatchObject({ fadeInFrames: 66000 });
        // No media rate, no fade.
        expect(drag('fadeIn', audio(), 8, 0, false, { ...GRID, media: null })).toEqual(audio());
        expect(drag('fadeIn', pattern, 8)).toBe(pattern);
    });

    it('drags gain up and down (Shift: finer), within the clip gain range', () => {
        expect(drag('gain', audio(), 0, -12)).toMatchObject({ gainDb: 6 });
        expect(drag('gain', audio(), 0, 10, true)).toMatchObject({ gainDb: -1 });
        expect(drag('gain', audio(), 0, -1000)).toMatchObject({ gainDb: 24 });
        expect(drag('gain', audio(), 0, 1000)).toMatchObject({ gainDb: -96 });
    });

    it('slips the audio under the clip on the grid (Shift: to the pixel), within the media', () => {
        // Content one beat later: the anchor plays a beat earlier in the source.
        expect(drag('alt', audio({ offsetFrames: 48000 }), 32)).toMatchObject({ offsetFrames: 24000, startStep: 16 });
        expect(drag('alt', audio({ offsetFrames: 48000 }), -32)).toMatchObject({ offsetFrames: 72000 });
        expect(drag('alt', audio({ offsetFrames: 48000 }), 3, 0, true)).toMatchObject({ offsetFrames: 48000 - 2250 });
        expect(drag('alt', audio({ offsetFrames: 1000 }), 32)).toMatchObject({ offsetFrames: 0 });
        expect(drag('alt', audio(), -1e6)).toMatchObject({ offsetFrames: MEDIA.frames });
        expect(drag('alt', pattern, 32)).toBe(pattern);
    });
});

describe('clipDragPatch', () => {
    it('holds the fields that changed, or nothing', () => {
        const clip = audio();
        expect(clipDragPatch(clip, clip)).toBeNull();
        expect(clipDragPatch(clip, { ...clip, fadeInFrames: 10, gainDb: -1 })).toEqual({ fadeInFrames: 10, gainDb: -1 });
        expect(clipDragPatch(pattern, { ...pattern, startStep: 4 })).toEqual({ startStep: 4 });
    });
});

describe('split points', () => {
    it('snaps to the grid inside the clip, else to a step', () => {
        expect(splitStepNear(audio(), 21.2, 4)).toBe(20);
        expect(splitStepNear(audio(), 17.4, 4)).toBe(17);
        expect(splitStepNear(audio(), 31.4, 16)).toBe(31);
        expect(splitStepNear(audio(), 16.2, 4)).toBeNull();
        expect(splitStepNear(audio(), 40, 4)).toBeNull();
    });

    it('splits by key at the playhead inside the clip, else in the middle', () => {
        expect(keyboardSplitStep(audio(), 27, 4)).toBe(27);
        expect(keyboardSplitStep(audio(), -1, 4)).toBe(24);
        expect(keyboardSplitStep(audio(), 16, 4)).toBe(24);
        expect(keyboardSplitStep(audio({ lengthSteps: 1 }), -1, 4)).toBeNull();
    });
});

describe('fadeWidthsPx', () => {
    it('places the handles where the fades end, clamped to the clip', () => {
        expect(fadeWidthsPx(audio({ fadeInFrames: 12000, fadeOutFrames: 3000 }), MEDIA, GRID.clock, 8)).toEqual({ fadeIn: 16, fadeOut: 4 });
        expect(fadeWidthsPx(audio({ fadeInFrames: 1e9 }), MEDIA, GRID.clock, 8).fadeIn).toBe(128);
        expect(fadeWidthsPx(audio({ fadeInFrames: 12000 }), null, GRID.clock, 8)).toEqual({ fadeIn: 0, fadeOut: 0 });
    });
});
