import re

with open('src/hooks/useAppState.tsx', 'r') as f:
    content = f.read()

search = """const handleNotePropertyChange = useCallback((
    key: 'timbre' | 'velocity' | 'probability' | 'microtiming' | 'reverse' | 'retrigger' | 'freeze' | 'formantShift' |
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
         'vowel' | 'portamento' | 'slideFormant',
    value: number | boolean | string
) => {"""


replace = """const handleNotePropertyChange = useCallback((
    key: 'timbre' | 'velocity' | 'probability' | 'microtiming' | 'reverse' | 'retrigger' | 'freeze' | 'formantShift' |
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
         'vowel' | 'portamento' | 'slideFormant',
    value: number | boolean | string
) => {"""


if search in content:
    content = content.replace(search, replace)
else:
    print("search not found")

with open('src/hooks/useAppState.tsx', 'w') as f:
    f.write(content)
