import re
import os

files_to_fix = [
    'src/components/DrawableLFO.tsx',
    'src/components/DrumPads.tsx',
    'src/components/OscillatorModuleSelector.tsx',
    'src/components/PerformanceMode.tsx',
    'src/components/SamplerPanel.tsx',
    'src/components/SamplerPitchControls.tsx',
    'src/components/SamplerVoicePanel.tsx',
    'src/components/Toast.tsx',
    'src/components/rbs-import-modal/ImportOptionsPanel.tsx',
    'src/components/ShortcutsHelp.tsx',
    'src/components/DrumMachine.tsx',
    'src/components/note-selector/PropertyToggle.tsx',
    'src/components/appParts/RackNode.tsx',
    'src/components/PhonemePainter.tsx',
    'src/components/AISongModal.tsx',
    'src/components/CloudLibrary.tsx',
    'src/components/RbsImportModal.tsx',
    'src/components/sampler/HarmonizerPopover.tsx',
    'src/components/sampler-panel/SamplerToolbar.tsx'
]

for filename in files_to_fix:
    try:
        with open(filename, 'r') as f:
            content = f.read()

        # We want to add type="button" to unstyled buttons.
        # But only where it is not already present to avoid duplicates.
        content = re.sub(r'<button\b(?![^>]*\btype=)', r'<button type="button"', content)

        with open(filename, 'w') as f:
            f.write(content)
        print(f"Fixed {filename}")
    except Exception as e:
        print(f"Error fixing {filename}: {e}")
