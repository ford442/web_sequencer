import re

with open('src/components/note-selector/SynthGranularEffects.tsx', 'r') as f:
    content = f.read()

count = content.count('id="note-phoneme-delay-amount"')
print(f"Delay amount UI instances: {count}")
