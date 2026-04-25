import re

with open('src/hooks/useAudioEngine.ts', 'r') as f:
    content = f.read()

content = re.sub(
    r'            const playSynth = createPlaySynth\(context, playbackRefs\);',
    r'            const playSynth = createPlaySynth(context, playbackRefs) as any;',
    content
)
content = re.sub(
    r'            const playDrum = createPlayDrum\(context, playbackRefs\);',
    r'            const playDrum = createPlayDrum(context, playbackRefs) as any;',
    content
)

with open('src/hooks/useAudioEngine.ts', 'w') as f:
    f.write(content)
