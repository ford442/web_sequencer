import re

with open('src/components/appParts/ContextMenuNode.tsx', 'r') as f:
    content = f.read()

search = """    handleNotePropertyChange: (key: 'timbre' | 'velocity' | 'probability' | 'microtiming' | 'reverse' | 'retrigger' | 'freeze' | 'formantShift' |
        'filterCutoff' | 'filterResonance' | 'envMod' |
        'formantLfoSync' | 'formantLfoRate' | 'formantLfoDepth' |
        'freezeLfoSync' | 'freezeLfoRate' | 'freezeLfoDepth' |
        'formantEnvAttack' | 'formantEnvDecay' | 'formantEnvAmount' | 'formantEnvSync' |
        'vibratoDepth' | 'drive' | 'characterMorph' |
        'reverbSend' | 'reverbType' | 'reverbLfoRate' | 'reverbLfoDepth' |
        'delayLfoRate' | 'delayLfoDepth' | 'delaySend' |
        'freezeEnvDepth' | 'timeStretchEnvDepth' | 'pan' | 'glitchChance' |
        'grainEnvDepth' | 'grainPitchQuantize' | 'granularPitchShift' |
        'choir' | 'gateDepth' | 'gateRate' | 'tranceGate' | 'bitcrush' | 'downsample' |
        'vowel' | 'portamento' | 'slideFormant', value: number | boolean | string) => void;"""

replace = """    handleNotePropertyChange: (key: 'timbre' | 'velocity' | 'probability' | 'microtiming' | 'reverse' | 'retrigger' | 'freeze' | 'formantShift' |
        'filterCutoff' | 'filterResonance' | 'envMod' |
        'formantLfoSync' | 'formantLfoRate' | 'formantLfoDepth' |
        'freezeLfoSync' | 'freezeLfoRate' | 'freezeLfoDepth' |
        'formantEnvAttack' | 'formantEnvDecay' | 'formantEnvAmount' | 'formantEnvSync' |
        'vibratoDepth' | 'drive' | 'characterMorph' |
        'reverbSend' | 'reverbType' | 'reverbLfoRate' | 'reverbLfoDepth' |
        'delayLfoRate' | 'delayLfoDepth' | 'delaySend' |
        'freezeEnvDepth' | 'timeStretchEnvDepth' | 'pan' | 'glitchChance' |
        'grainEnvDepth' | 'grainPitchQuantize' | 'granularPitchShift' |
        'choir' | 'gateDepth' | 'gateRate' | 'tranceGate' | 'bitcrush' | 'downsample' |
        'spectralPanRate' | 'spectralPanDepth' |
        'vowel' | 'portamento' | 'slideFormant', value: number | boolean | string) => void;"""


if search in content:
    content = content.replace(search, replace)
else:
    print("search not found")

with open('src/components/appParts/ContextMenuNode.tsx', 'w') as f:
    f.write(content)
