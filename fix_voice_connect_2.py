import re

with open('src/hooks/audioEngine/audioPlayback.ts', 'r') as f:
    content = f.read()

voice_reverb_replace = """                const reverbSendAmount = noteParams?.reverbSend !== undefined ? noteParams.reverbSend : 0;
                // Currently setReverbSend assumes global reverb on the Voice object.
                // We'll need to use setReverbSend if it exists, or handle custom routing if Voice supports it.
                // For now, let's just use the voice.setReverbSend interface which the AudioEngine expects.
                if (typeof voice.setReverbSend === 'function') {
                    voice.setReverbSend(reverbSendAmount, noteTime);
                }"""

content = re.sub(
    r'                const reverbSendAmount = noteParams\?\.reverbSend !== undefined \? noteParams\.reverbSend : 0;\n                const currentReverbType = noteParams\?\.reverbType \|\| refs\.reverbTypeRef\.current;\n                const targetReverbNode = refs\.reverbNodesRef\.current\[currentReverbType\] \|\| refs\.reverbNodesRef\.current\[\'plate\'\];\n                \n                if \(reverbSendAmount > 0 && targetReverbNode\) \{\n                    const reverbGain = context\.createGain\(\);\n                    reverbGain\.gain\.value = reverbSendAmount;\n                    reverbGain\.connect\(targetReverbNode\);\n                    voice\.setReverbSend\(reverbSendAmount, noteTime\); \/\/ Connect using the voice interface\n                \}',
    voice_reverb_replace,
    content
)

with open('src/hooks/audioEngine/audioPlayback.ts', 'w') as f:
    f.write(content)
