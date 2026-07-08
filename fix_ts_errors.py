import re

with open('src/hooks/useAudioEngine.ts', 'r') as f:
    content = f.read()

# Add missing imports for DrumKitEngine and ProphecyManager
if 'import { DrumKitEngine }' not in content:
    content = content.replace("import { MultisampleGenerator } from '../engines/MultisampleGenerator';", "import { MultisampleGenerator } from '../engines/MultisampleGenerator';\nimport { DrumKitEngine } from '../engines/DrumKitEngine';\nimport { ProphecyManager } from '../engines/ProphecyManager';")

with open('src/hooks/useAudioEngine.ts', 'w') as f:
    f.write(content)
