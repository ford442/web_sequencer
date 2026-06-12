import re

with open('src/hooks/useAudioEngine.ts', 'r') as f:
    content = f.read()

# Fix unassigned finalDestination
content = content.replace("let finalDestination: AudioNode;", "let finalDestination: AudioNode = masterSaturationRef.current as unknown as AudioNode;")

with open('src/hooks/useAudioEngine.ts', 'w') as f:
    f.write(content)
