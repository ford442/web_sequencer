import re

with open('docs/refactoring/module-size-budget.md', 'r') as f:
    content = f.read()

content = content.replace("| `src/audio-worklets/rubberband-processor.ts` | The core worker for TTS and sampling is naturally dense; moving sub-effects out would require exposing many more class variables. |", "| `src/audio-worklets/rubberband-processor.ts` | The core worker for TTS and sampling is naturally dense. |\n| `src/components/note-selector/SynthGranularEffects.tsx` | Added Phoneme Delay UI |")

with open('docs/refactoring/module-size-budget.md', 'w') as f:
    f.write(content)
