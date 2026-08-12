# Agent Plan

## Active Backlog
- [x] Implement Phoneme-driven auto-rhythm generation for TTS
- [x] Add granular random jitter per phoneme
- [x] Add multi-voice unison detune
- [ ] Optimize TTS memory footprint
- [ ] Add granular synthesis window shape control for TTS playback

## Innovation Lab
- [x] Implement reverse TTS sample per step
- [x] Implement Phoneme Envelope shaping per step
- [x] Implement Expressive Note Transitions for Vowels

- [x] Optimize TTS memory footprint
- [x] Implement Lyric Track parsing
- [x] Implement Vowel-Preserving Time Stretch for TTS voices
- [x] Implement per-phoneme pitch drift/vibrato
- [x] Add Formant Modulation LFO
- [x] Add Formant Glide per phoneme
- [ ] Add granular random jitter per phoneme
- [ ] Optimize Voice Manager state syncing
- [x] Optimize Voice Manager state syncing
- [x] Add granular synthesis window shape control for TTS playback
- [x] What if we could apply an LFO to the TTS formant shift directly from the step sequencer?

## Refactoring Roadblocks
- [x] Ensure all VoiceManagers (e.g., VoiceManager, SingingVoiceManager) use similar logic patterns for acquiring/releasing/stopping voices to prevent unexpected UI/Audio desync issues.
- What if we explored a true zero-allocation path for TTS Voice scheduling using RingBuffers directly from the sequencer?

## Architecture Review
- Velocity Check: The optimization task was straightforward. For the next run, I should consider a more complex architectural goal, such as unifying the voice allocation logic across all Synth and Sampler engines into a generic VoicePool base class to reduce duplication.

## Roadmap
