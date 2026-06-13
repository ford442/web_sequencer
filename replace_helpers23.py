import re

with open('src/components/NoteSelector.tsx', 'r') as f:
    content = f.read()

search = """    currentGrainPitchQuantize?: number;
    currentGranularPitchShift?: number;
    currentChoir?: number;"""

replace = """    currentGrainPitchQuantize?: number;
    currentGranularPitchShift?: number;
    currentChoir?: number;
    currentTimeStretchEnvDepth?: number;
    currentSpectralPanRate?: number;
    currentSpectralPanDepth?: number;"""

if search in content:
    content = content.replace(search, replace)
else:
    print("search not found")

with open('src/components/NoteSelector.tsx', 'w') as f:
    f.write(content)
