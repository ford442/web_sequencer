import re

with open('src/hooks/useAudioEngine.ts', 'r') as f:
    lines = f.readlines()

for i, line in enumerate(lines):
    # Import AudioNodePool
    if 'import { AudioNodePool }' in line:
        continue # Already imported
    if i == 0:
        lines.insert(0, "import { AudioNodePool } from '../utils/AudioNodePool';\n")

with open('src/hooks/useAudioEngine.ts', 'w') as f:
    f.writelines(lines)
