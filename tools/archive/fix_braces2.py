with open('src/hooks/audioEngine/audioPlayback.ts', 'r') as f:
    lines = f.readlines()

# Remove the last extra }
for i in range(len(lines)-1, -1, -1):
    if lines[i].strip() == '}':
        del lines[i]
        break

with open('src/hooks/audioEngine/audioPlayback.ts', 'w') as f:
    f.writelines(lines)
