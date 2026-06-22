with open('src/hooks/audioEngine/audioPlayback.ts', 'r') as f:
    content = f.read()

lines = content.split('\n')
lines.insert(562, "}")

with open('src/hooks/audioEngine/audioPlayback.ts', 'w') as f:
    f.write('\n'.join(lines))
