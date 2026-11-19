/**
 * Clip editing on the arrangement (#1342, #1629 P2) as pure functions: what a
 * drag previews, what it commits, where a split lands and where an audio
 * clip's fade handles sit. `ArrangementView` wires them to pointer and key
 * events; a drag previews locally and commits once, on release, so it is one
 * undo step.
 *
 * Drag modes:
 *   move · start · end   the clip, its head (the content stays put) or its tail
 *   fadeIn · fadeOut     an audio clip's fade, from its top-corner handle
 *   gain                 an audio clip's gain, dragging its top handle up / down
 *   alt                  Alt + drag slips an audio clip's content under it
 *                        (`offsetFrames`); Alt + click splits any clip there
 *
 * Moves, trims, splits and slips snap to the grid unit (Shift: one step; a
 * slip with Shift follows the pointer to the pixel). Fades and gain are free.
 */
import type { ArrangementClip, AudioClip, MediaRef } from '@/types/song';
import { AUDIO_CLIP_GAIN_DB_RANGE, clipEnd, isAudioClip, type ClipPatch } from '@/arrangement/model';
import { clipAnchorStep, songStepAtSeconds, songStepSeconds, type StepClock } from '@/audio/audioTracks/clipTiming';
import { clamp } from '@/utils/math';

export type ClipDragMode = 'move' | 'start' | 'end' | 'fadeIn' | 'fadeOut' | 'gain' | 'alt';

/** Pointer travel (CSS px) under which an Alt press is a click, not a slip. */
export const CLICK_SLOP_PX = 3;

export interface ClipDragOrigin {
    mode: ClipDragMode;
    clip: ArrangementClip;
    originX: number;
    originY: number;
}

export interface DragGrid {
    pxPerStep: number;
    /** Grid unit in steps. */
    snap: number;
    clock: StepClock;
    /** The audio clip's media, when the song knows it (fades and slips need its rate). */
    media: MediaRef | null;
}

/** The clip's left and right edges in seconds from song step 0. */
function edgeSeconds(clip: ArrangementClip, clock: StepClock): [number, number] {
    return [songStepSeconds(clip.startStep, clock), songStepSeconds(clipEnd(clip), clock)];
}

/** A fade dragged `dx` px from where its handle was. */
function dragFade(clip: AudioClip, edge: 'in' | 'out', dx: number, grid: DragGrid): AudioClip {
    const media = grid.media;
    if (!media || dx === 0) return clip;
    const rate = media.sampleRate;
    const [startSec, endSec] = edgeSeconds(clip, grid.clock);
    const clipFrames = Math.round((endSec - startSec) * rate);
    const end = clipEnd(clip);
    if (edge === 'in') {
        const handle = songStepAtSeconds(startSec + (clip.fadeInFrames ?? 0) / rate, grid.clock);
        const at = clamp(handle + dx / grid.pxPerStep, clip.startStep, end);
        const frames = Math.round((songStepSeconds(at, grid.clock) - startSec) * rate);
        return { ...clip, fadeInFrames: clamp(frames, 0, Math.max(0, clipFrames - (clip.fadeOutFrames ?? 0))) };
    }
    const handle = songStepAtSeconds(endSec - (clip.fadeOutFrames ?? 0) / rate, grid.clock);
    const at = clamp(handle + dx / grid.pxPerStep, clip.startStep, end);
    const frames = Math.round((endSec - songStepSeconds(at, grid.clock)) * rate);
    return { ...clip, fadeOutFrames: clamp(frames, 0, Math.max(0, clipFrames - (clip.fadeInFrames ?? 0))) };
}

/** Content dragged `steps` later under a fixed clip: the source frame at the anchor moves back. */
function slip(clip: AudioClip, steps: number, grid: DragGrid): AudioClip {
    const media = grid.media;
    if (!media || steps === 0) return clip;
    const anchor = clipAnchorStep(clip);
    const seconds = songStepSeconds(anchor + steps, grid.clock) - songStepSeconds(anchor, grid.clock);
    return { ...clip, offsetFrames: clamp(Math.round(clip.offsetFrames - seconds * media.sampleRate), 0, media.frames) };
}

/** What the clip looks like with the pointer at (`x`, `y`). */
export function clipDragPreview(drag: ClipDragOrigin, x: number, y: number, shift: boolean, grid: DragGrid): ArrangementClip {
    const { clip, mode } = drag;
    const dx = x - drag.originX;
    const unit = shift ? 1 : grid.snap;
    const delta = Math.round(dx / grid.pxPerStep / unit) * unit;
    switch (mode) {
        case 'move':
            return { ...clip, startStep: Math.max(0, clip.startStep + delta) };
        case 'end':
            return { ...clip, lengthSteps: Math.max(1, clip.lengthSteps + delta) };
        case 'start': {
            const shiftBy = Math.min(clip.lengthSteps - 1, Math.max(-clip.startStep, delta));
            // A head trim keeps the content where it is; extending left past
            // the source start is not possible, so the offset floors at 0.
            const offset = Math.max(0, (clip.offsetSteps ?? 0) + shiftBy);
            const applied = offset - (clip.offsetSteps ?? 0);
            return { ...clip, startStep: clip.startStep + applied, lengthSteps: clip.lengthSteps - applied, offsetSteps: offset };
        }
        case 'fadeIn':
        case 'fadeOut':
            return isAudioClip(clip) ? dragFade(clip, mode === 'fadeIn' ? 'in' : 'out', dx, grid) : clip;
        case 'gain': {
            if (!isAudioClip(clip) || y === drag.originY) return clip;
            const [lo, hi] = AUDIO_CLIP_GAIN_DB_RANGE;
            const db = clip.gainDb - (y - drag.originY) * (shift ? 0.1 : 0.5);
            return { ...clip, gainDb: clamp(Math.round(db * 10) / 10, lo, hi) };
        }
        case 'alt':
            return isAudioClip(clip) ? slip(clip, shift ? dx / grid.pxPerStep : delta, grid) : clip;
    }
}

const DRAG_FIELDS = ['startStep', 'lengthSteps', 'offsetSteps', 'fadeInFrames', 'fadeOutFrames', 'gainDb', 'offsetFrames'] as const;

/** The fields a drag changed, or null when it changed nothing. */
export function clipDragPatch(clip: ArrangementClip, preview: ArrangementClip): ClipPatch | null {
    const before = clip as unknown as Record<string, unknown>;
    const after = preview as unknown as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    for (const key of DRAG_FIELDS) if (before[key] !== after[key]) patch[key] = after[key];
    return Object.keys(patch).length ? (patch as ClipPatch) : null;
}

/** `step` as a split point strictly inside `clip`: snapped to the grid unit, else to a step; null when neither is inside. */
export function splitStepNear(clip: ArrangementClip, step: number, unit: number): number | null {
    const end = clipEnd(clip);
    for (const s of [Math.round(step / Math.max(1, unit)) * Math.max(1, unit), Math.round(step)]) {
        if (s > clip.startStep && s < end) return s;
    }
    return null;
}

/** Where a keyboard split lands: the playhead when it is inside the clip, else the clip's middle. */
export function keyboardSplitStep(clip: ArrangementClip, playhead: number, unit: number): number | null {
    if (playhead > clip.startStep && playhead < clipEnd(clip)) return playhead;
    return splitStepNear(clip, clip.startStep + clip.lengthSteps / 2, unit);
}

/** How far an audio clip's fades reach in from its edges, in px: where their handles sit. */
export function fadeWidthsPx(clip: AudioClip, media: MediaRef | null, clock: StepClock, pxPerStep: number): { fadeIn: number; fadeOut: number } {
    if (!media) return { fadeIn: 0, fadeOut: 0 };
    const [startSec, endSec] = edgeSeconds(clip, clock);
    const end = clipEnd(clip);
    const inStep = songStepAtSeconds(startSec + (clip.fadeInFrames ?? 0) / media.sampleRate, clock);
    const outStep = songStepAtSeconds(endSec - (clip.fadeOutFrames ?? 0) / media.sampleRate, clock);
    return {
        fadeIn: (clamp(inStep, clip.startStep, end) - clip.startStep) * pxPerStep,
        fadeOut: (end - clamp(outStep, clip.startStep, end)) * pxPerStep,
    };
}
