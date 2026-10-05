import re

with open('src/audio-worklets/rubberband-processor.ts', 'r') as f:
    content = f.read()

content = content.replace("  private readonly bassDuck = new DrumDuckEnvelope();", "  private readonly bassDuck = new DrumDuckEnvelope();\n  private bassDuckingScalar = 0;")

with open('src/audio-worklets/rubberband-processor.ts', 'w') as f:
    f.write(content)
