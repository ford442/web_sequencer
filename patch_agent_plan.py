import re

with open('agent_plan.md', 'r') as f:
    content = f.read()

# Add to changelog
changelog_entry = """* [2026-07-04] - Implemented Multiband Distortion for TTS: Updated `vocal-overdrive-processor.ts` to include a 1-pole state variable filter crossover. Applied asymmetric tube clipping specifically to the high-frequency band to prevent fundamental pitch muddying.
"""

content = re.sub(r'(## 📜 Changelog\n)', r'\1' + changelog_entry, content)

# Add to Innovation Lab
innovation_entry = """* **Idea:** "Formant-Aware Reverb" - Dynamically adjust the reverb decay and EQ based on the active vowel being sung to prevent high-frequency sibilance buildup.
* **Idea:** "Spectral Panning" - Split the TTS audio into multiple frequency bands and dynamically pan them across the stereo field based on an LFO to create wide, swirling vocal textures.
"""

content = re.sub(r'(## 🧠 Innovation Lab \(The "Dream" Log\)\n)', r'\1' + innovation_entry, content)

with open('agent_plan.md', 'w') as f:
    f.write(content)
