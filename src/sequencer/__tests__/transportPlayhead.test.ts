import { afterEach, describe, expect, it, vi } from 'vitest';
import { playheadPosition, transportPlayhead } from '../transportPlayhead';

const steps = (partA: number) => ({ partA, partB: 3, bass2: 3, kick: 3, snare: 3, closedHat: 3, openHat: 3, sampler: 1 });

describe('transportPlayhead', () => {
    afterEach(() => transportPlayhead.stop());

    it('publishes each track its own step (polyrhythm / arrangement)', () => {
        const listener = vi.fn();
        const unsub = transportPlayhead.subscribe(listener);
        transportPlayhead.publish(3, steps(11), 0.125);
        const snap = transportPlayhead.get();
        expect(snap.step).toBe(3);
        expect(snap.trackSteps.partA).toBe(11);
        expect(snap.trackSteps.sampler).toBe(1);
        expect(listener).toHaveBeenCalledTimes(1);
        unsub();
    });

    it('interpolates within the step and reads null while stopped or resting', () => {
        transportPlayhead.publish(0, steps(4), 0.1);
        const at = transportPlayhead.get().at;
        expect(playheadPosition(transportPlayhead.get(), 'partA', at)).toBe(4);
        expect(playheadPosition(transportPlayhead.get(), 'partA', at + 50)).toBeCloseTo(4.5);
        expect(playheadPosition(transportPlayhead.get(), 'partA', at + 500)).toBeLessThan(5);
        transportPlayhead.publish(1, steps(-1), 0.1);
        expect(playheadPosition(transportPlayhead.get(), 'partA')).toBeNull();
        transportPlayhead.stop();
        expect(playheadPosition(transportPlayhead.get(), 'partB')).toBeNull();
        expect(transportPlayhead.get().trackSteps.partB).toBe(-1);
    });
});
