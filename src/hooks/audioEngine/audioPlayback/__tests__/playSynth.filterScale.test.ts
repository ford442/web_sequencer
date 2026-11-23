import { describe, expect, it, vi } from 'vitest';
import { createPlaySynth } from '../playSynth';
import type { SynthParams } from '../../../../types';

/**
 * Step and lane filter values are 0-1 knob positions. They must scale with the
 * knob's own full-scale (8000 Hz / 20), because Open303Manager divides the Hz
 * back by 8000 — a 20000 multiplier pinned any lane above 0.4 to fully open.
 */
function setup() {
    const applyLead303Params = vi.fn();
    const refs = {
        masterGainRef: { current: {} },
        open303ManagerRef: {
            current: {
                isLead303Ready: () => true,
                isBass1Ready: () => true,
                isBass2Ready: () => true,
                applyLead303Params,
                applyBass1Params: vi.fn(),
                scheduleParamAtTime: vi.fn(),
                noteOnLead303: vi.fn(),
                noteOffLead303: vi.fn(),
                noteOnBass1: vi.fn(),
                noteOffBass1: vi.fn(),
            },
        },
        prophecyManagerRef: { current: null },
        macroManagerRef: { current: null },
        voiceManagerARef: { current: null },
        voiceManagerBRef: { current: null },
        reverbNodesRef: { current: null },
        reverbTypeRef: { current: 'room' },
        bassSidechainEQBusRef: { current: null },
        singingVoiceManagerRef: { current: null },
    };
    const context = { currentTime: 0 } as unknown as AudioContext;
    const playSynth = createPlaySynth(context, refs as unknown as Parameters<typeof createPlaySynth>[1]);
    return { playSynth, applyLead303Params };
}

const params = {
    waveform: '303-saw',
    filterCutoff: 4000,
    filterResonance: 10,
    filterMode: 0,
    decay: 0.2,
    volume: 0.8,
    pitch: 0,
    drive: 0,
} as unknown as SynthParams;

describe('playSynth filter overrides', () => {
    it('maps a 0-1 cutoff lane onto the knob range (8000 Hz full scale)', () => {
        const { playSynth, applyLead303Params } = setup();
        playSynth(params, 'C3', 0, 1, 0.2, undefined, 'partA', { filterCutoff: 0.4 });
        const sent = applyLead303Params.mock.calls[0][0] as SynthParams;
        expect(sent.filterCutoff).toBeCloseTo(3200);
        // What the worklet receives: 0.4, the lane value — not clamped to 1.
        expect(sent.filterCutoff / 8000).toBeCloseTo(0.4);
    });

    it('maps a 0-1 resonance lane onto the knob range (20 full scale)', () => {
        const { playSynth, applyLead303Params } = setup();
        playSynth(params, 'C3', 0, 1, 0.2, undefined, 'partA', { filterResonance: 0.25 });
        expect((applyLead303Params.mock.calls[0][0] as SynthParams).filterResonance).toBeCloseTo(5);
    });

    it('leaves the knob values alone when a step has no filter override', () => {
        const { playSynth, applyLead303Params } = setup();
        playSynth(params, 'C3', 0, 1, 0.2, undefined, 'partA', undefined);
        const sent = applyLead303Params.mock.calls[0][0] as SynthParams;
        expect(sent.filterCutoff).toBe(4000);
        expect(sent.filterResonance).toBe(10);
    });
});
