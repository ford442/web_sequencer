import re

with open('src/engines/singing-voice/playback.ts', 'r') as f:
    content = f.read()

import_statement = "import type { PhonemeData } from '../../types';\n"
if "import type { PhonemeData }" not in content:
    content = content.replace('import type { SingingVoiceHost } from "./host";', import_statement + 'import type { SingingVoiceHost } from "./host";')

old_send = """  sendPhonemeDataToWorklet(
    this: SingingVoiceHost,
    targetDuration?: number,
  ): void {"""

new_send = """  sendPhonemeDataToWorklet(
    this: SingingVoiceHost,
    targetDuration?: number,
    userPhonemes?: PhonemeData[],
  ): void {"""

content = content.replace(old_send, new_send)

old_create = """    // Create shared buffer with phoneme data
    const sharedBuffer = this.phonemeAligner.createSharedPhonemeBuffer(
      phonemes,
      this.audioContext.sampleRate,
    );"""

new_create = """    // Create shared buffer with phoneme data
    const sharedBuffer = this.phonemeAligner.createSharedPhonemeBuffer(
      phonemes,
      this.audioContext.sampleRate,
      userPhonemes,
    );"""

content = content.replace(old_create, new_create)

with open('src/engines/singing-voice/playback.ts', 'w') as f:
    f.write(content)

print("Patched playback.ts for sendPhonemeDataToWorklet")
