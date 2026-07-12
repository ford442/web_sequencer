with open('src/hooks/audioEngine/audioPlayback.ts', 'r') as f:
    lines = f.readlines()

# We need to find the missing brace. Where is `createPlaySynth` closed?
# line 562 is `export function createNoteOnSynth`
for i in range(540, 565):
    print(f"{i+1}: {repr(lines[i])}")
