/**
 * Audio Playback Module
 * 
 * Provides playback functions for all sound sources:
 * - Synth (oscillators, WAV playback, Open303)
 * - Drums (kick, snare, hats)
 * - Sampler (one-shot, looped, time-stretched)
 */

// Synth playback
export {
    playSynth,
    noteOnSynth,
    noteOffSynth,
    stopAllSynthNotes,
    apply303Params,
    type SynthPlaybackContext,
    type SynthNoteState,
} from './synthPlayback';

// Drum playback
export {
    playDrum,
    type DrumPlaybackContext,
} from './drumPlayback';

// Sampler playback
export {
    playSampler,
    noteOnSampler,
    noteOffSampler,
    stopAllSamplerNotes,
    loadSampleToEngine,
    prepareVocal,
    type SamplerPlaybackContext,
    type SamplerState,
} from './samplerPlayback';
