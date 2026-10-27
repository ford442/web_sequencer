import { describe, expect, it, vi } from 'vitest';
import { ConcatenativeHybrid, VowelLibrary } from '@/engines/rubberband/ConcatenativeHybrid';
import type { SamplerBankParams } from '@/types';
import { connectVowelCrossfade, planVowelLayer } from '../vowelLayer';

const SR = 48000;

function hybrid(): ConcatenativeHybrid {
    const library = new VowelLibrary();
    library.addSample({
        vowel: 'ah', midiNote: 60, audio: new Float32Array(SR), sampleRate: SR, loopStart: 4800, loopEnd: 28800,
    });
    return new ConcatenativeHybrid({ sampleRate: SR }, library);
}

const bank = (extra: Partial<SamplerBankParams> = {}) =>
    ({ sampleName: 'bank_0', mode: 'stretch', useVowelSamplesOnLongNotes: true, ...extra }) as SamplerBankParams;

describe('planVowelLayer', () => {
    it('is off by default per bank', () => {
        expect(planVowelLayer(hybrid(), bank({ useVowelSamplesOnLongNotes: undefined }), 2, 60, null)).toBeNull();
    });

    it('stays TTS before the pack loads, in phoneme slice mode, and for a non-note', () => {
        expect(planVowelLayer(null, bank(), 2, 60, null)).toBeNull();
        expect(planVowelLayer(hybrid(), bank({ sliceMode: 'phoneme' }), 2, 60, null)).toBeNull();
        expect(planVowelLayer(hybrid(), bank(), 2, null, null)).toBeNull();
    });

    it('applies the bank’s own duration gate', () => {
        expect(planVowelLayer(hybrid(), bank(), 0.4, 60, null)).toBeNull();
        expect(planVowelLayer(hybrid(), bank({ minNoteDurationMs: 300 }), 0.4, 60, null)).not.toBeNull();
        expect(planVowelLayer(hybrid(), bank(), 0.6, 60, null)?.sample.vowel).toBe('ah');
    });
});

describe('connectVowelCrossfade', () => {
    function fakeContext() {
        const gain = {
            value: 1,
            setValueAtTime: vi.fn(),
            setValueCurveAtTime: vi.fn<(curve: Float32Array, at: number, duration: number) => void>(),
        };
        const node = { gain, connect: vi.fn() };
        return { ctx: { createGain: () => node } as unknown as BaseAudioContext, node, gain };
    }

    it('fades the TTS voice out and the vowel voice in at the same moment', () => {
        const plan = planVowelLayer(hybrid(), bank(), 2, 67, null)!;
        const dest = {} as AudioNode;

        const tts = fakeContext();
        expect(connectVowelCrossfade(tts.ctx, { plan, role: 'tts' }, 10, dest)).toBe(tts.node);
        expect(tts.node.connect).toHaveBeenCalledWith(dest);
        const [outCurve, outAt, outDur] = tts.gain.setValueCurveAtTime.mock.calls[0];
        expect(outCurve[0]).toBe(1);
        expect(outCurve[outCurve.length - 1]).toBeCloseTo(0, 9);

        const vowel = fakeContext();
        connectVowelCrossfade(vowel.ctx, { plan, role: 'vowel' }, 10, dest);
        expect(vowel.gain.value).toBe(0); // silent until the crossfade
        const [inCurve, inAt, inDur] = vowel.gain.setValueCurveAtTime.mock.calls[0];
        expect(inCurve[0]).toBe(0);
        expect(inCurve[inCurve.length - 1]).toBeCloseTo(1, 9);

        expect(inAt).toBe(outAt);
        expect(inAt).toBeCloseTo(10 + plan.crossfadeStart, 9);
        expect(inDur).toBe(outDur);
        expect(inDur).toBe(0.05);
    });
});
