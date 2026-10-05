import re

with open('src/components/note-selector/SynthGranularEffects.tsx', 'r') as f:
    content = f.read()

if "Phoneme Delay" in content:
    print("Found UI!")
else:
    print("UI missing!")
