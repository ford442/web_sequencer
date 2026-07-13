import re

with open('src/hooks/useAudioEngine.ts', 'r') as f:
    content = f.read()

# Make sure drumKitEngineRef is exported properly
if 'drumKitEngineRef' not in content.split('return useMemo(() => ({')[1]:
    content = content.replace(
        'updateSamplerVoiceParams\n    }), [audioEngine',
        'updateSamplerVoiceParams,\n        drumKitEngineRef\n    }), [audioEngine'
    )

with open('src/hooks/useAudioEngine.ts', 'w') as f:
    f.write(content)
