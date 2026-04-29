import re

file_path = 'src/hooks/audioEngine/initialization.ts'
with open(file_path, 'r') as f:
    content = f.read()

content = content.replace(
    'masterCompressorRef: MutableRefObject<DynamicsCompressorNode | null>,',
    'masterCompressorRef: MutableRefObject<DynamicsCompressorNode | null>,\n    sidechainBusRef: MutableRefObject<GainNode | null>,'
)

content = content.replace(
    'masterSaturation.connect(masterCompressor);',
    '''const sidechainBus = context.createGain();
    sidechainBus.gain.setValueAtTime(1, 0); // Default open
    sidechainBusRef.current = sidechainBus;
    
    sidechainBus.connect(masterSaturation);
    masterSaturation.connect(masterCompressor);'''
)

with open(file_path, 'w') as f:
    f.write(content)
