import re
import datetime

file_path = 'agent_plan.md'

with open(file_path, 'r') as f:
    content = f.read()

# Add to changelog
today = datetime.date.today().strftime('%Y-%m-%d')
changelog_entry = f"## {today} - Implemented Global Macro Knobs: Added 4 global macro knobs to the `BottomBar` UI and plumbed `globalMacro1` through `globalMacro4` through `useAppState` into `useAudioEngine`. The macros map dynamically to parameters in both Synth (Cutoff, Delay Mix, Drive, Resonance) and Sampler (Formant Shift, Reverb/Delay Send, Drive/Bitcrush, Formant LFO Rate) engines, providing a unified performance control surface. Fulfills the \"Global Macro Knobs\" Innovation Lab idea.\n\n"
content = re.sub(r'## 📜 Changelog\n', f"## 📜 Changelog\n{changelog_entry}", content, count=1)

# Check off Global Macro Knobs
content = re.sub(r'\* \*\*Idea:\*\* "Global Macro Knobs" - Implement 4 global macro knobs that can be assigned to multiple parameters across synth and sampler engines simultaneously.', '* [x] **Idea:** "Global Macro Knobs" - Implement 4 global macro knobs that can be assigned to multiple parameters across synth and sampler engines simultaneously.', content)

# Add new ideas to Innovation Lab
new_ideas = """* **Idea:** "Macro Automation Lanes" - Extend the global macro system to allow drawing step-sequenced automation lanes specifically for the macro knobs.
* **Idea:** "Vocal Arpeggiator" - Add an arpeggiator specifically for the TTS engine that triggers different phoneme slices in a rhythmic pattern when a chord is held.
"""
content = re.sub(r'## 🧠 Innovation Lab \(The "Dream" Log\)\n', f'## 🧠 Innovation Lab (The "Dream" Log)\n{new_ideas}', content, count=1)

with open(file_path, 'w') as f:
    f.write(content)
