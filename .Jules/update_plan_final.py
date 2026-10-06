import re

with open('.Jules/agent_plan.md', 'r') as f:
    content = f.read()

content = content.replace("- [ ] Implement dynamic spatialization routing per phoneme (e.g. delay sends driven by phoneme intensity).", "- [x] Implement dynamic spatialization routing per phoneme (e.g. delay sends driven by phoneme intensity).")

architecture_review = """
- Completed "Implement dynamic spatialization routing per phoneme (e.g. delay sends driven by phoneme intensity)." Implemented a `PhonemeDelayEffect` delay line inside `RubberBandProcessor` that echoes the signal based on phoneme intensity and vowel status. Wired it up to the `phonemeDelayAmount` and `phonemeDelayFeedback` parameters in the UI (bank knobs in `SamplerKnobControls.tsx` and per-step sliders in `SynthGranularEffects.tsx`) and correctly routed through types and state.
- Velocity Check: Hooking into the phoneme data for spatialization works very well and adds immediate rhythmic and musical interest to the TTS output, specifically by only repeating vowels and keeping the echo clean from consonants. The plumbing across `playSamplerVoice.ts` and `EffectsControlMixin` matches our established pattern, preventing any friction. Added real-time cross-synthesis task to the backlog.
"""

content = content.replace("## Architecture Review\n", "## Architecture Review\n" + architecture_review)

with open('.Jules/agent_plan.md', 'w') as f:
    f.write(content)
