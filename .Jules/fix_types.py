import re

with open('src/types/sampler.ts', 'r') as f:
    content = f.read()
if "phonemeDelayAmount?: number;" not in content:
    content = content.replace("  vocalChorus?: number;\n", "  vocalChorus?: number;\n  phonemeDelayAmount?: number;\n  phonemeDelayFeedback?: number;\n")
    with open('src/types/sampler.ts', 'w') as f:
        f.write(content)

with open('src/types/pattern.ts', 'r') as f:
    content = f.read()
if "phonemeDelayAmount?: number;" not in content:
    content = content.replace("  vocalChorus?: number;\n", "  vocalChorus?: number;\n  phonemeDelayAmount?: number;\n  phonemeDelayFeedback?: number;\n")
    with open('src/types/pattern.ts', 'w') as f:
        f.write(content)
