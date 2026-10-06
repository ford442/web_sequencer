import re

with open('src/hooks/audioEngine/samplerPlayback/playSamplerVoice.ts', 'r') as f:
    content = f.read()

apply = """
        if (pPhonemeDelayAmount !== undefined && voice.setPhonemeDelayAmount) voice.setPhonemeDelayAmount(pPhonemeDelayAmount, triggerTime);
        if (pPhonemeDelayFeedback !== undefined && voice.setPhonemeDelayFeedback) voice.setPhonemeDelayFeedback(pPhonemeDelayFeedback, triggerTime);
"""

content = content.replace("        if (pVocalChorus !== undefined && voice.setVocalChorus) voice.setVocalChorus(pVocalChorus, triggerTime);", "        if (pVocalChorus !== undefined && voice.setVocalChorus) voice.setVocalChorus(pVocalChorus, triggerTime);" + apply)

with open('src/hooks/audioEngine/samplerPlayback/playSamplerVoice.ts', 'w') as f:
    f.write(content)
