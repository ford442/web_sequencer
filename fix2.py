with open('src/components/SamplerVoicePanel.tsx', 'r') as f:
    content = f.read()

content = content.replace("import { Harmonizer, type HarmonizerConfig } from '../engines/Harmonizer';",
                          "import { type HarmonizerConfig } from '../engines/Harmonizer';")

with open('src/components/SamplerVoicePanel.tsx', 'w') as f:
    f.write(content)
