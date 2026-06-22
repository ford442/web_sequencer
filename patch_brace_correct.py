with open('src/hooks/audioEngine/audioPlayback.ts', 'r') as f:
    content = f.read()

lines = content.split('\n')
del lines[562] # remove the extra }
with open('src/hooks/audioEngine/audioPlayback.ts', 'w') as f:
    f.write('\n'.join(lines))
