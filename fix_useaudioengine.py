import re

with open('src/hooks/useAudioEngine.ts', 'r') as f:
    content = f.read()

content = re.sub(
    r'voice\.setFormantLfoShape\(null\);',
    r'voice.setFormantLfoShape(undefined);',
    content
)

with open('src/hooks/useAudioEngine.ts', 'w') as f:
    f.write(content)
