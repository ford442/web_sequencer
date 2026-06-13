import re

with open('src/components/NoteSelector.tsx', 'r') as f:
    content = f.read()

search = """    currentGrainEnvDepth?: number;
    currentGrainPitchQuantize?: number;
    currentGranularPitchShift?: number;
    currentTranceGate?: number;"""

replace = """    currentGrainEnvDepth?: number;
    currentGrainPitchQuantize?: number;
    currentGranularPitchShift?: number;
    currentTimeStretchEnvDepth?: number;
    currentSpectralPanRate?: number;
    currentSpectralPanDepth?: number;
    currentTranceGate?: number;"""

if search in content:
    content = content.replace(search, replace)
else:
    print("search not found")

with open('src/components/NoteSelector.tsx', 'w') as f:
    f.write(content)
