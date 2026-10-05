import re

with open('src/components/appParts/ContextMenuNode.tsx', 'r') as f:
    content = f.read()

content = content.replace("currentVocoderMix={stepData?.vocoderMix}", "currentVocoderMix={stepData?.vocoderMix}\n          currentPhonemeDelayAmount={stepData?.phonemeDelayAmount}\n          currentPhonemeDelayFeedback={stepData?.phonemeDelayFeedback}")

with open('src/components/appParts/ContextMenuNode.tsx', 'w') as f:
    f.write(content)
