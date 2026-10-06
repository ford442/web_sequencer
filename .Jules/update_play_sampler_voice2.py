import re

with open('src/hooks/audioEngine/samplerPlayback/playSamplerVoice.ts', 'r') as f:
    content = f.read()

assignments = """
    const pPhonemeDelayAmount = noteParams?.phonemeDelayAmount !== undefined ? noteParams.phonemeDelayAmount : params.phonemeDelayAmount;
    const pPhonemeDelayFeedback = noteParams?.phonemeDelayFeedback !== undefined ? noteParams.phonemeDelayFeedback : params.phonemeDelayFeedback;
"""

content = content.replace("    const pVocalChorus = noteParams?.vocalChorus !== undefined ? noteParams.vocalChorus : params.vocalChorus;", "    const pVocalChorus = noteParams?.vocalChorus !== undefined ? noteParams.vocalChorus : params.vocalChorus;" + assignments)

apply = """
      if (pPhonemeDelayAmount !== undefined) voice.setPhonemeDelayAmount(pPhonemeDelayAmount);
      if (pPhonemeDelayFeedback !== undefined) voice.setPhonemeDelayFeedback(pPhonemeDelayFeedback);
"""

content = content.replace("      if (pVocalChorus !== undefined) voice.setVocalChorus(pVocalChorus);", "      if (pVocalChorus !== undefined) voice.setVocalChorus(pVocalChorus);" + apply)

with open('src/hooks/audioEngine/samplerPlayback/playSamplerVoice.ts', 'w') as f:
    f.write(content)
