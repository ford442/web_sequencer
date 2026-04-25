import re

with open('src/types.ts', 'r') as f:
    content = f.read()

content = content.replace(
    "  formantLfoDepth?: number; // Formant LFO depth (0-1)",
    "  formantLfoDepth?: number; // Formant LFO depth (0-1)\n  formantEnvAttack?: number; // Formant Envelope Attack time in seconds\n  formantEnvDecay?: number; // Formant Envelope Decay time in seconds\n  formantEnvAmount?: number; // Formant Envelope Amount (semitones shift)"
)

content = content.replace(
    "drive?: number; }) => void;",
    "drive?: number; formantEnvAttack?: number; formantEnvDecay?: number; formantEnvAmount?: number; }) => void;"
)

with open('src/types.ts', 'w') as f:
    f.write(content)
