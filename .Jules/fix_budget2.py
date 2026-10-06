import re

with open('docs/refactoring/module-size-budget.md', 'r') as f:
    content = f.read()

content = content.replace("| `src/audio-worklets/rubberband-processor.ts` |", "| `src/audio-worklets/rubberband-processor.ts` | Adding PhonemeDelayEffect |")

with open('docs/refactoring/module-size-budget.md', 'w') as f:
    f.write(content)
