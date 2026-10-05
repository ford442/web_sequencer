import re

with open('src/engines/singing-voice/effectsControl.ts', 'r') as f:
    content = f.read()

content = content.replace("    if (effects.vocalChorus !== undefined) this.setVocalChorus(effects.vocalChorus, time);", "    if (effects.vocalChorus !== undefined) this.setVocalChorus(effects.vocalChorus, time);\n    if (effects.phonemeDelayAmount !== undefined) this.setPhonemeDelayAmount(effects.phonemeDelayAmount, time);\n    if (effects.phonemeDelayFeedback !== undefined) this.setPhonemeDelayFeedback(effects.phonemeDelayFeedback, time);")

with open('src/engines/singing-voice/effectsControl.ts', 'w') as f:
    f.write(content)

with open('src/engines/singing-voice/types.ts', 'r') as f:
    content = f.read()

funcs = """
  setPhonemeDelayAmount(amount: number, time?: number): void;
  setPhonemeDelayFeedback(amount: number, time?: number): void;
"""
content = content.replace("  setVocalChorus(amount: number, time?: number): void;", "  setVocalChorus(amount: number, time?: number): void;" + funcs)

with open('src/engines/singing-voice/types.ts', 'w') as f:
    f.write(content)
