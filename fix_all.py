import re

# Fix PhonemePainter
with open('src/components/PhonemePainter.tsx', 'r') as f:
    content = f.read()

content = content.replace('// @ts-expect-error - Auto-generated to fix CI build\n                        left: selectedPhoneme.pitchBend <= 0 ? `${50 + (selectedPhoneme.pitchBend / 200) * 50}%` : \'50%\'',
                          'left: selectedPhoneme.pitchBend <= 0 ? `${50 + (selectedPhoneme.pitchBend / 200) * 50}%` : \'50%\'')

with open('src/components/PhonemePainter.tsx', 'w') as f:
    f.write(content)

# Fix App.tsx missing AI states
with open('src/App.tsx', 'r') as f:
    content = f.read()

# Make sure AI states are present where needed.
ai_states = """    // AI Song Import loading states
    const [isImportingAISong, setIsImportingAISong] = useState(false);
    const [aiImportProgress, setAiImportProgress] = useState(0);
    const [aiImportStage, setAiImportStage] = useState<'parsing' | 'validating' | 'converting' | 'uploading' | 'loading' | 'complete' | 'error' | null>(null);
    const [aiImportError, setAiImportError] = useState<string | null>(null);"""

if "const [isImportingAISong, setIsImportingAISong] = useState(false);" not in content:
    content = content.replace("    const [isCloudLibraryOpen, setIsCloudLibraryOpen] = useState(false);",
                              f"    const [isCloudLibraryOpen, setIsCloudLibraryOpen] = useState(false);\n{ai_states}")

# Fix App.tsx missing refs
if "const currentStepRef = useRef(-1);" not in content:
    print("WARNING: currentStepRef missing")
else:
    print("currentStepRef found")

with open('src/App.tsx', 'w') as f:
    f.write(content)
