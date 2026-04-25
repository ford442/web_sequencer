import re

with open('src/hooks/audioEngine/audioPlayback.ts', 'r') as f:
    content = f.read()

content = re.sub(
    r'export interface SynthNoteParams \{\n    timbre\?: number;\n    microtiming\?: number;\n    retrigger\?: number;\n    filterCutoff\?: number;\n    filterResonance\?: number;\n    envMod\?: number;\n    delaySend\?: number;\n\}',
    r'export interface SynthNoteParams {\n    timbre?: number;\n    microtiming?: number;\n    retrigger?: number;\n    filterCutoff?: number;\n    filterResonance?: number;\n    envMod?: number;\n    delaySend?: number;\n    reverbSend?: number;\n    reverbType?: import("../../types").ReverbType;\n}',
    content
)

with open('src/hooks/audioEngine/audioPlayback.ts', 'w') as f:
    f.write(content)
