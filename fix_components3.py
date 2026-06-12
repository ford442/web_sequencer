with open('src/components/NoteSelector.tsx', 'r') as f:
    content = f.read()

content = content.replace("        | 'tranceGate'", "        | 'tranceGate'\n        | 'bitcrush'\n        | 'downsample'")

with open('src/components/NoteSelector.tsx', 'w') as f:
    f.write(content)
