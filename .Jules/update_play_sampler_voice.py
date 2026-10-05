import re

with open('src/hooks/audioEngine/samplerPlayback/playSamplerVoice.ts', 'r') as f:
    content = f.read()

assignments = """
    const pPhonemeDelayAmount = noteParams?.phonemeDelayAmount ?? params.phonemeDelayAmount ?? 0;
    const pPhonemeDelayFeedback = noteParams?.phonemeDelayFeedback ?? params.phonemeDelayFeedback ?? 0;
"""

content = content.replace("    const pSubHarmonics = noteParams?.subHarmonics ?? params.subHarmonics ?? 0;", "    const pSubHarmonics = noteParams?.subHarmonics ?? params.subHarmonics ?? 0;" + assignments)

apply = """
      phonemeDelayAmount: pPhonemeDelayAmount,
      phonemeDelayFeedback: pPhonemeDelayFeedback,
"""

content = content.replace("      subHarmonics: pSubHarmonics,", "      subHarmonics: pSubHarmonics," + apply)

with open('src/hooks/audioEngine/samplerPlayback/playSamplerVoice.ts', 'w') as f:
    f.write(content)

with open('src/hooks/audioEngine/audioPlayback/types.ts', 'r') as f:
    content = f.read()

content = content.replace("  vocalChorus?: number;\n", "  vocalChorus?: number;\n  phonemeDelayAmount?: number;\n  phonemeDelayFeedback?: number;\n")

with open('src/hooks/audioEngine/audioPlayback/types.ts', 'w') as f:
    f.write(content)
