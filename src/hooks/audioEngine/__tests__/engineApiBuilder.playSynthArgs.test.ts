import { describe, expect, it, vi } from 'vitest';

const inner = vi.fn();
vi.mock('../audioPlayback/playSynth', () => ({ createPlaySynth: () => inner }));

import { buildAudioEngine } from '../engineApiBuilder';

/**
 * `AudioEngine['playSynth']` is called as (…, track, tuning, noteParams) by the step
 * handler, but the implementation takes (…, track, noteParams, tuning). When the two were
 * crossed, `noteParams` arrived as the scale and every per-step value — velocity, pan,
 * and the cutoff / resonance automation lanes — was dropped.
 */
describe('buildAudioEngine().playSynth argument order', () => {
    it('hands noteParams (not the scale) to the synth implementation', () => {
        // Every ref reads as an empty ref and every playback fn as a spy: only playSynth is under test.
        const anyRef = new Proxy({}, { get: () => ({ current: null }) });
        const anyFn = new Proxy({}, { get: () => vi.fn() });
        const engine = buildAudioEngine({} as AudioContext, anyRef as any, anyFn as any);
        const scale = { name: 'just', ratios: [1] };
        const noteParams = { velocity: 0.3, filterCutoff: 0.4 };

        engine.playSynth({} as any, 'C3', 1, 2, 0.2, undefined, 'partA', scale as any, noteParams);

        const args = inner.mock.calls[0];
        expect(args[7]).toBe(noteParams);
        expect(args[8]).toBe(scale);
    });
});
