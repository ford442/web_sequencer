import sys

def apply_patch():
    file_path = "src/hooks/useAudioEngine.ts"
    with open(file_path, "r") as f:
        content = f.read()

    target = "                    reverbLfoDepth?: number,"
    replacement = "                    reverbLfoDepth?: number,\n                    glitchChance?: number,"

    if target in content:
        content = content.replace(target, replacement)
        with open(file_path, "w") as f:
            f.write(content)

apply_patch()
