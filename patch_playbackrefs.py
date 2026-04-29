import re

file_path = 'src/hooks/audioEngine/audioPlayback.ts'
with open(file_path, 'r') as f:
    content = f.read()

content = content.replace(
    'masterCompressorRef: MutableRefObject<DynamicsCompressorNode | null>;',
    'masterCompressorRef: MutableRefObject<DynamicsCompressorNode | null>;\n    sidechainBusRef: MutableRefObject<GainNode | null>;'
)

with open(file_path, 'w') as f:
    f.write(content)
