/**
 * Song steps → audio frames for audio clips (#1629 D4): the arithmetic the live
 * player and the offline render share, so both put a clip on the same frame.
 *
 * Steps follow the transport clock (`clock-processor.ts`): a 16th is
 * `T = 60 / (tempo · 4)` seconds, and swing moves `swing · T / 2` from every
 * odd step to the even step before it, by the parity of the clock's absolute
 * step count. A pair of steps is always `2T`.
 *
 * An audio clip with `warp: 'off'` plays its source in real time from its
 * anchor — `offsetSteps` before its left edge, where source frame
 * `offsetFrames` sounds — so the source frame at any song step follows from
 * the seconds between the anchor and that step.
 */

import type { AudioClip } from '@/types/song';
import { DECLICK_LEFT, DECLICK_RIGHT, type ClipVoiceSpec } from '@/shared/rt/audioClipVoice';

export interface StepClock {
    tempo: number;
    /** Clock swing, 0 (straight) … 1 (`swingPercentToClock`). */
    swing: number;
}

/**
 * Seconds from song step `from` to `to` (`to ≥ from`); `fromParity` is the
 * clock parity of `from` (0 = even).
 */
export function stepSpanSeconds(from: number, to: number, fromParity: number, clock: StepClock): number {
    const T = 60 / (Math.max(1, clock.tempo) * 4);
    const n = Math.max(0, to - from);
    let seconds = n * T;
    if (n % 2 === 1) {
        // An odd span from an even step ends after its long step; from an odd one, after a short one.
        const shift = clock.swing * T * 0.5;
        seconds += (fromParity & 1) === 0 ? shift : -shift;
    }
    return seconds;
}

/**
 * Seconds from song step 0 to song step `step`, which may be fractional (a
 * point inside a step: the step's length is spread evenly over it) or
 * negative (an anchor before the song start). Song step 0 is on even clock
 * parity, as in the offline render. For whole steps,
 * `songStepSeconds(b) - songStepSeconds(a)` is `stepSpanSeconds(a, b, a & 1)`.
 */
export function songStepSeconds(step: number, clock: StepClock): number {
    const T = 60 / (Math.max(1, clock.tempo) * 4);
    const shift = clock.swing * T * 0.5;
    const whole = Math.floor(step);
    const odd = (whole & 1) === 1;
    return whole * T + (odd ? shift : 0) + (step - whole) * (odd ? T - shift : T + shift);
}

/** The (fractional) song step `seconds` after song step 0: the inverse of `songStepSeconds`. */
export function songStepAtSeconds(seconds: number, clock: StepClock): number {
    const T = 60 / (Math.max(1, clock.tempo) * 4);
    const long = T + clock.swing * T * 0.5;
    const pair = Math.floor(seconds / (2 * T));
    const rest = seconds - pair * 2 * T;
    return rest < long ? 2 * pair + rest / long : 2 * pair + 1 + (rest - long) / Math.max(1e-9, 2 * T - long);
}

/**
 * The source frame (fractional) a `warp: 'off'` clip plays at song step
 * `step`, in the media's own frames. It may lie outside the media (before its
 * first frame or past its last), where the clip is silent.
 */
export function clipSourceFrameAt(clip: AudioClip, step: number, clock: StepClock, mediaRate: number): number {
    return clip.offsetFrames + (songStepSeconds(step, clock) - songStepSeconds(clipAnchorStep(clip), clock)) * mediaRate;
}

/** The anchor step of a clip: where source frame `offsetFrames` sounds. */
export function clipAnchorStep(clip: AudioClip): number {
    return clip.startStep - (clip.offsetSteps ?? 0);
}

/**
 * Where a voice for `clip` starting at song step `pos` (context frame
 * `frame`) reads and stops. `parityAt(step)` is the clock parity of a song step.
 */
export function clipVoiceSpec(
    clip: AudioClip,
    pos: number,
    frame: number,
    parityAt: (step: number) => number,
    clock: StepClock,
    contextRate: number,
    media: { sampleRate: number; frames: number },
): { spec: ClipVoiceSpec; sourceStart: number } | null {
    const end = clip.startStep + clip.lengthSteps;
    if (pos < clip.startStep || pos >= end) return null;
    const rate = media.sampleRate / contextRate;
    const anchor = clipAnchorStep(clip);
    const fromAnchor = stepSpanSeconds(anchor, pos, parityAt(anchor), clock);
    const source = clip.offsetFrames + fromAnchor * media.sampleRate;
    const exact = rate === 1;
    const sourceStart = exact ? Math.round(source) : Math.floor(source);
    const clipStartFrame = frame - Math.round(stepSpanSeconds(clip.startStep, pos, parityAt(clip.startStep), clock) * contextRate);
    const clipEndFrame = frame + Math.round(stepSpanSeconds(pos, end, parityAt(pos), clock) * contextRate);
    // An edge that cuts the source mid-way gets a declick; the source's own start and end do not.
    const atLeft = clip.offsetFrames + stepSpanSeconds(anchor, clip.startStep, parityAt(anchor), clock) * media.sampleRate;
    const atRight = clip.offsetFrames + stepSpanSeconds(anchor, end, parityAt(anchor), clock) * media.sampleRate;
    const declickEdges = (atLeft >= 0.5 ? DECLICK_LEFT : 0) | (atRight <= media.frames - 0.5 ? DECLICK_RIGHT : 0);
    return {
        sourceStart,
        spec: {
            startFrame: frame,
            endFrame: clipEndFrame,
            clipStartFrame,
            clipEndFrame,
            fadeInFrames: Math.round((clip.fadeInFrames ?? 0) / rate),
            fadeOutFrames: Math.round((clip.fadeOutFrames ?? 0) / rate),
            gain: clip.gainDb <= -96 ? 0 : Math.pow(10, clip.gainDb / 20),
            rate,
            frac: exact ? 0 : source - sourceStart,
            sourceFrames: Math.max(0, media.frames - sourceStart),
            declickEdges,
        },
    };
}

/** Frames a voice that started at song step `pos` stops on, if the clip's end moved. */
export function clipEndFrame(
    clip: AudioClip,
    pos: number,
    frame: number,
    parity: number,
    clock: StepClock,
    contextRate: number,
): number {
    return frame + Math.round(stepSpanSeconds(pos, clip.startStep + clip.lengthSteps, parity, clock) * contextRate);
}

