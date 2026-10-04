import re

with open('src/components/sampler-panel/useSamplerPanelState.ts', 'r') as f:
    content = f.read()

content = content.replace("'vocalChorus', ", "'vocalChorus', 'phonemeDelayAmount', 'phonemeDelayFeedback', ")

with open('src/components/sampler-panel/useSamplerPanelState.ts', 'w') as f:
    f.write(content)
