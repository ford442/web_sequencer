import re

with open('src/audio-worklets/vocal-overdrive-processor.ts', 'r') as f:
    content = f.read()

# Add declare const sampleRate: number; to the top of the file
content = re.sub(r'(declare function registerProcessor.*?;\n)', r'\1declare const sampleRate: number;\n', content)

with open('src/audio-worklets/vocal-overdrive-processor.ts', 'w') as f:
    f.write(content)
