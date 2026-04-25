with open('agent_plan.md', 'r') as f:
    content = f.read()

content = content.replace(
    "- [ ] **Vocal Formant Envelope:** Add a dedicated Attack/Decay envelope specifically for formants to create plucky or sweeping vocal filter effects on every note.",
    "- [x] **Vocal Formant Envelope:** Add a dedicated Attack/Decay envelope specifically for formants to create plucky or sweeping vocal filter effects on every note."
)

content = content.replace(
    "* **Idea:** \"Vocal Formant Envelope\" - Add a dedicated Attack/Decay envelope specifically for formants to create plucky or sweeping vocal filter effects on every note.",
    "* [x] **Idea:** \"Vocal Formant Envelope\" - Add a dedicated Attack/Decay envelope specifically for formants to create plucky or sweeping vocal filter effects on every note. (Implemented in FormantShifter and SamplerPanel!)"
)

log_entry = "* [2026-06-27] - Implemented Vocal Formant Envelope: Added Formant Envelope parameters to `SamplerBankParams` and `Note` interfaces, allowing users to modulate formant detune amounts via an attack/decay envelope on `ConstantSourceNode` and `GainNode`. Added global and per-step controls to `SamplerPanel` and `NoteSelector`."
content = content.replace(
    "## 📜 Changelog",
    f"## 📜 Changelog\n{log_entry}"
)

with open('agent_plan.md', 'w') as f:
    f.write(content)
