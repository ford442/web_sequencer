import re
with open('agent_plan.md', 'r') as f:
    content = f.read()

content = re.sub(r"-\s*\[\s*\]\s*\*\*Phoneme Elasticity\*\*", "- [x] **Phoneme Elasticity**", content)

with open('agent_plan.md', 'w') as f:
    f.write(content)
import re

with open('agent_plan.md', 'r') as f:
    content = f.read()

# Check off the specific backlog items
content = re.sub(r'- \[ \] \*\*Gesture Controls:\*\*', r'- [x] **Gesture Controls:**', content)
content = re.sub(r'- \[ \] \*\*Custom Waveform LFO:\*\*', r'- [x] **Custom Waveform LFO:**', content)

# Ensure the new task is added
new_backlog = """- [ ] **Vocal Formant Envelope:** Add a dedicated Attack/Decay envelope specifically for formants to create plucky or sweeping vocal filter effects on every note.
- [ ] **Step-Sequenced Reverb Types:** Allow sequence steps to override the global reverb type (e.g., switch from a small room to a massive hall on a specific snare or vocal slice).
- [x] **Per-Step Delay Send:** Allow sequence steps to override the global delay send amount to create rhythmic echoes for TTS or synth sequences."""

if "Per-Step Delay Send" not in content:
    content = re.sub(r'### Domain C: Accessibility & Mobile', new_backlog + '\n\n### Domain C: Accessibility & Mobile', content)

# Check off the task in innovation lab
if "Per-Step Delay Send" not in content.split("## 🧠 Innovation Lab")[1]:
    innovation_lab = """* [x] **Idea:** "Per-Step Delay Send" - Allow sequence steps to override the global delay send amount to create rhythmic echoes for TTS or synth sequences. (Implemented!)
* **Idea:** "Vocal Formant Envelope" - Add a dedicated Attack/Decay envelope specifically for formants to create plucky or sweeping vocal filter effects on every note.
* **Idea:** "Step-Sequenced Reverb Types" - Allow sequence steps to override the global reverb type (e.g., switch from a small room to a massive hall on a specific snare or vocal slice)."""
    content = re.sub(r'\* \*\*Idea:\*\* "AI Auto-Mix Assistant"', innovation_lab + '\n* **Idea:** "AI Auto-Mix Assistant"', content)

# Add changelog entry
new_changelog = """* [2026-06-27] - Implemented Per-Step Delay Send: Added `delaySend` parameter to `Note` interface and updated `NoteSelector` UI to include a slider. Plumbed the parameter through `App.tsx` and updated `useAudioEngine.ts` to allow both Sampler (`playSamplerVoice`) and Synth (`VoiceManager`) engines to override the global delay send bus per-step. Fulfills the "Per-Step Delay Send" Innovation Lab idea."""
if "Implemented Per-Step Delay Send" not in content:
    content = re.sub(r'## 📜 Changelog\n', r'## 📜 Changelog\n' + new_changelog + '\n', content)

with open('agent_plan.md', 'w') as f:
    f.write(content)
