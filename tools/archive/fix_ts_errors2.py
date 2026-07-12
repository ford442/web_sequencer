import re

with open('src/hooks/useAppState.tsx', 'r') as f:
    content = f.read()

# Remove drumKitEngineRef from useAppState since it doesn't need to be there or should be optional
content = content.replace(
    'const { audioEngine, isReady, initializeAudio, onParamChange, drumKitEngineRef } = useAudioEngine(pyodide, tempo)',
    'const { audioEngine, isReady, initializeAudio, onParamChange } = useAudioEngine(pyodide, tempo)'
)

# And remove it from the drumKitEngineRef useEffect... wait, drumKitEngineRef is used in useAppState.tsx
# In useAudioEngine.ts, we need to return drumKitEngineRef

with open('src/hooks/useAppState.tsx', 'w') as f:
    f.write(content)

with open('src/hooks/useAudioEngine.ts', 'r') as f:
    content = f.read()

if 'drumKitEngineRef' not in content.split('return useMemo(() => ({')[1]:
    content = content.replace(
        'updateSamplerVoiceParams\n    }), [audioEngine',
        'updateSamplerVoiceParams,\n        drumKitEngineRef\n    }), [audioEngine'
    )

with open('src/hooks/useAudioEngine.ts', 'w') as f:
    f.write(content)
