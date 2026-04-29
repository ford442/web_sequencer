import re

file_path = 'src/hooks/useAudioEngine.ts'
with open(file_path, 'r') as f:
    content = f.read()

content = content.replace(
    'const masterCompressorRef = useRef<DynamicsCompressorNode | null>(null);',
    'const masterCompressorRef = useRef<DynamicsCompressorNode | null>(null);\n    const sidechainBusRef = useRef<GainNode | null>(null);'
)

content = content.replace(
    'masterCompressorRef,\n        reverbNodesRef,',
    'masterCompressorRef,\n        sidechainBusRef,\n        reverbNodesRef,'
)

content = content.replace(
    'initializeMasterOutput(context, masterGainRef, masterPannerRef, masterSaturationRef, masterCompressorRef);',
    'initializeMasterOutput(context, masterGainRef, masterPannerRef, masterSaturationRef, masterCompressorRef, sidechainBusRef);'
)

with open(file_path, 'w') as f:
    f.write(content)
