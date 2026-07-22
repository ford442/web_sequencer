import re

with open('src/hooks/audioEngine/samplerPlayback.ts', 'r') as f:
    content = f.read()

old_send = """        // 3. Phoneme Awareness (from Jules branch)
        if (ctx.alignment) {
            voice.setAlignment(ctx.alignment);
            voice.sendPhonemeDataToWorklet(targetDuration);
        }"""

new_send = """        // 3. Phoneme Awareness (from Jules branch)
        if (ctx.alignment) {
            voice.setAlignment(ctx.alignment);
            voice.sendPhonemeDataToWorklet(targetDuration, ctx.noteParams?.phonemes);
        }"""

content = content.replace(old_send, new_send)

with open('src/hooks/audioEngine/samplerPlayback.ts', 'w') as f:
    f.write(content)

print("Patched samplerPlayback.ts for sendPhonemeDataToWorklet")
