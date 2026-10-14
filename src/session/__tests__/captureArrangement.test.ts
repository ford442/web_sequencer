import { describe, expect, it } from 'vitest';
import { NUM_STEPS } from '../../constants';
import { SessionLaunchEngine } from '../SessionLaunchEngine';
import { createDefaultSessionDocument } from '../defaults';
import { secondsPerStep } from '../quantize';
import { captureEventsToArrangement } from '../capture';
import type { SessionCaptureEvent, TransportClockSnapshot } from '../types';

function clock(step: number): TransportClockSnapshot {
    return {
        step: step % NUM_STEPS,
        audioTime: 1 + step * secondsPerStep(120),
        tempo: 120,
        patternSteps: NUM_STEPS,
        stepsPerBeat: 4,
        stepsPerBar: 16,
        isPlaying: true,
        songModeActive: false,
    };
}

function ev(timelineStep: number, track: SessionCaptureEvent['track'], slotIndex: number | null, action: SessionCaptureEvent['action'] = 'start'): SessionCaptureEvent {
    return { audioTime: 0, step: timelineStep % NUM_STEPS, timelineStep, track, action, clipId: null, slotIndex };
}

describe('captureEventsToArrangement', () => {
    it('turns two scene launches into clips with their real start steps', () => {
        const doc = createDefaultSessionDocument();
        for (const row of [0, 1]) {
            doc.columns.kick.clips[row].empty = false;
            doc.scenes[row].clipIds.kick = doc.columns.kick.clips[row].id;
        }
        const engine = new SessionLaunchEngine(doc);
        engine.setQuantization('bar');
        engine.armCapture();

        engine.enqueue({ kind: 'scene', source: 'scene', requestAudioTime: clock(0).audioTime, requestStep: 0, sceneId: doc.scenes[0].id }, clock(0));
        for (let s = 0; s <= 40; s++) {
            if (s === 8) {
                engine.enqueue({ kind: 'scene', source: 'scene', requestAudioTime: clock(8).audioTime, requestStep: 8, sceneId: doc.scenes[1].id }, clock(8));
            }
            engine.tick(clock(s));
        }
        const endStep = engine.timelineStep;
        const arr = captureEventsToArrangement(engine.disarmCapture(), { stepsPerMeasure: 16, endStep });

        const kick = arr.clips.filter((c) => c.track === 'kick');
        expect(kick.map((c) => [c.patternSlot, c.startStep, c.lengthSteps])).toEqual([
            [0, 0, 16],
            // Queued at step 8, quantized to the next bar; runs to the release (40 → bar 48).
            [1, 16, 32],
        ]);
        expect(arr.lengthSteps).toBe(48);
    });

    it('closes a clip on stop and rebases the timeline to the first launch bar', () => {
        const arr = captureEventsToArrangement(
            [ev(36, 'kick', 2), ev(40, 'snare', 1), ev(44, 'kick', null, 'stop')],
            { stepsPerMeasure: 16 },
        );
        expect(arr.clips.map((c) => [c.track, c.patternSlot, c.startStep, c.lengthSteps])).toEqual([
            ['kick', 2, 4, 8],
            ['snare', 1, 8, 8],
        ]);
        expect(arr.lengthSteps).toBe(16);
    });

    it('keeps clip identity where the Song Mode compile collapsed it', () => {
        // Two launches inside one measure: Song Mode kept only the last one.
        const arr = captureEventsToArrangement([ev(0, 'kick', 0), ev(8, 'kick', 1)], { stepsPerMeasure: 32 });
        expect(arr.clips.map((c) => [c.patternSlot, c.startStep, c.lengthSteps])).toEqual([[0, 0, 8], [1, 8, 24]]);
    });

    it('returns an empty one-measure arrangement for no events', () => {
        expect(captureEventsToArrangement([], { stepsPerMeasure: 24 })).toEqual({ clips: [], lengthSteps: 24 });
    });
});
