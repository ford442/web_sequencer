/**
 * Song steps ↔ seconds for drawing and editing audio clips (#1629 P2): the
 * fractional mapping agrees with the clock's whole-step spans, swing
 * included, so a waveform is drawn where the voice plays it.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { AudioClip } from '@/types/song';
import { clipSourceFrameAt, clipVoiceSpec, songStepAtSeconds, songStepSeconds, stepSpanSeconds } from '../clipTiming';

const clockArb = fc.record({ tempo: fc.integer({ min: 40, max: 300 }), swing: fc.double({ min: 0, max: 1, noNaN: true }) });

describe('songStepSeconds', () => {
    it('matches the clock span between whole steps, from either parity and below zero', () => {
        fc.assert(fc.property(clockArb, fc.integer({ min: -64, max: 512 }), fc.nat(300), (clock, from, n) => {
            const span = songStepSeconds(from + n, clock) - songStepSeconds(from, clock);
            expect(span).toBeCloseTo(stepSpanSeconds(from, from + n, from & 1, clock), 9);
        }));
    });

    it('spreads a step evenly over its length, and inverts', () => {
        const clock = { tempo: 120, swing: 0.5 };
        // Step 0 is long (0.125 + 0.03125 s), step 1 short.
        expect(songStepSeconds(0.5, clock)).toBeCloseTo(0.078125, 9);
        expect(songStepSeconds(1, clock)).toBeCloseTo(0.15625, 9);
        expect(songStepSeconds(1.5, clock)).toBeCloseTo(0.15625 + 0.046875, 9);
        fc.assert(fc.property(clockArb, fc.double({ min: -40, max: 400, noNaN: true }), (c, step) => {
            expect(songStepAtSeconds(songStepSeconds(step, c), c)).toBeCloseTo(step, 6);
        }));
    });
});

describe('clipSourceFrameAt', () => {
    const clip: AudioClip = {
        kind: 'audio', id: 'clip-1', track: 'audio-1', mediaId: 'a'.repeat(64),
        startStep: 21, lengthSteps: 30, offsetSteps: 3, offsetFrames: 1234, gainDb: 0, warp: 'off',
    };

    it('is the frame the voice starts on at any whole step of the clip', () => {
        fc.assert(fc.property(clockArb, fc.integer({ min: 21, max: 50 }), (clock, pos) => {
            const media = { sampleRate: 44100, frames: 10_000_000 };
            // Resampled: the voice keeps the fraction.
            const resampled = clipVoiceSpec(clip, pos, 0, (s) => s & 1, clock, 48000, media)!;
            expect(clipSourceFrameAt(clip, pos, clock, 44100)).toBeCloseTo(resampled.sourceStart + resampled.spec.frac, 6);
            // At the context rate it starts on the nearest whole frame.
            const exact = clipVoiceSpec(clip, pos, 0, (s) => s & 1, clock, 44100, media)!;
            expect(Math.abs(clipSourceFrameAt(clip, pos, clock, 44100) - exact.sourceStart)).toBeLessThanOrEqual(0.5);
        }));
    });

    it('puts offsetFrames on the anchor and runs in real time at the media rate', () => {
        const clock = { tempo: 120, swing: 0 };
        expect(clipSourceFrameAt(clip, 18, clock, 48000)).toBe(1234);
        expect(clipSourceFrameAt(clip, 26, clock, 48000)).toBeCloseTo(1234 + 48000, 6);
        expect(clipSourceFrameAt(clip, 17, clock, 48000)).toBeCloseTo(1234 - 6000, 6);
    });
});
