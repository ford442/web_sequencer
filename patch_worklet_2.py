import re

with open('src/audio-worklets/rubberband-processor.ts', 'r') as f:
    content = f.read()

# Update getPhonemeStretchRatio call
content = content.replace(
    "ratio = this.getPhonemeStretchRatio(this.currentSamplePtr);",
    "// Temp replacement for now\n          const [pRatio, pVol, pBend] = this.getPhonemeDataAtSample(this.currentSamplePtr);\n          ratio = pRatio;"
)

with open('src/audio-worklets/rubberband-processor.ts', 'w') as f:
    f.write(content)

print("Patched rubberband-processor.ts for getPhonemeStretchRatio call")
