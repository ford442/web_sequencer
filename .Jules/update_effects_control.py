import re

with open('src/engines/singing-voice/effectsControl.ts', 'r') as f:
    content = f.read()

assignments = """
    if (effects.phonemeDelayAmount !== undefined) this.setWorkletParam('phonemeDelayAmount', effects.phonemeDelayAmount, time);
    if (effects.phonemeDelayFeedback !== undefined) this.setWorkletParam('phonemeDelayFeedback', effects.phonemeDelayFeedback, time);
"""

content = content.replace("    if (effects.vocalChorus !== undefined) this.setWorkletParam('vocalChorus', effects.vocalChorus, time);", "    if (effects.vocalChorus !== undefined) this.setWorkletParam('vocalChorus', effects.vocalChorus, time);" + assignments)

with open('src/engines/singing-voice/effectsControl.ts', 'w') as f:
    f.write(content)
