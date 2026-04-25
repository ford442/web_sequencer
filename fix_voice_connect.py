import re

with open('src/hooks/audioEngine/audioPlayback.ts', 'r') as f:
    content = f.read()

content = re.sub(
    r'                    reverbGain\.connect\(targetReverbNode\);\n                    voice\.connectOutput\(reverbGain\);',
    r'                    reverbGain.connect(targetReverbNode);\n                    voice.setReverbSend(reverbSendAmount, noteTime); // Connect using the voice interface',
    content
)

with open('src/hooks/audioEngine/audioPlayback.ts', 'w') as f:
    f.write(content)
