import re

with open('src/engines/singing-voice/effectsControl.ts', 'r') as f:
    content = f.read()

funcs = """
  setPhonemeDelayAmount(this: SingingVoiceHost, amount: number, time?: number): void {
    setWorkletParam(this, "phonemeDelayAmount", amount, time);
  },
  setPhonemeDelayFeedback(this: SingingVoiceHost, amount: number, time?: number): void {
    setWorkletParam(this, "phonemeDelayFeedback", amount, time);
  },
"""
content = content.replace("  setVocalChorus(this: SingingVoiceHost, amount: number, time?: number): void {\n    setWorkletParam(this, \"vocalChorus\", amount, time);\n  },", "  setVocalChorus(this: SingingVoiceHost, amount: number, time?: number): void {\n    setWorkletParam(this, \"vocalChorus\", amount, time);\n  }," + funcs)

content = content.replace("    if (effects.vocalChorus !== undefined) this.setVocalChorus(effects.vocalChorus, time);", "    if (effects.vocalChorus !== undefined) this.setVocalChorus(effects.vocalChorus, time);\n    if (effects.phonemeDelayAmount !== undefined) this.setPhonemeDelayAmount(effects.phonemeDelayAmount, time);\n    if (effects.phonemeDelayFeedback !== undefined) this.setPhonemeDelayFeedback(effects.phonemeDelayFeedback, time);")

with open('src/engines/singing-voice/effectsControl.ts', 'w') as f:
    f.write(content)
