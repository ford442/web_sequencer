import re

with open('src/hooks/useAppState.tsx', 'r') as f:
    content = f.read()

content = content.replace(
    'const { audioEngine, isReady, initializeAudio, onParamChange } = useAudioEngine(pyodide, tempo)',
    'const { audioEngine, isReady, initializeAudio, onParamChange, drumKitEngineRef } = useAudioEngine(pyodide, tempo)'
)

with open('src/hooks/useAppState.tsx', 'w') as f:
    f.write(content)
