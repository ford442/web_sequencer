import { describe, expectTypeOf, it } from 'vitest';
import type { AudioEngine, Note, SamplerNoteParams } from '../../types';

describe('SamplerNoteParams', () => {
    it('carries the per-step vocoder, spectral-pan and formant-envelope overrides', () => {
        expectTypeOf<SamplerNoteParams>().toHaveProperty('vocoderMix');
        expectTypeOf<SamplerNoteParams>().toHaveProperty('phonemeDelayAmount');
        expectTypeOf<SamplerNoteParams>().toHaveProperty('phonemeDelayFeedback');
        expectTypeOf<SamplerNoteParams>().toHaveProperty('spectralPanDepth');
        expectTypeOf<SamplerNoteParams>().toHaveProperty('formantEnvAmount');
        expectTypeOf<SamplerNoteParams>().toHaveProperty('slideFromMidi');
    });

    it('accepts a Note spread but not the pitch fields', () => {
        expectTypeOf<Omit<Note, 'note' | 'chord' | 'phonemes'>>().toMatchTypeOf<SamplerNoteParams>();
        expectTypeOf<SamplerNoteParams>().not.toHaveProperty('note');
    });

    it('is the noteParams type of AudioEngine.playSampler (no any)', () => {
        type Arg = Parameters<AudioEngine['playSampler']>[5];
        expectTypeOf<Arg>().toEqualTypeOf<SamplerNoteParams | undefined>();
    });
});
