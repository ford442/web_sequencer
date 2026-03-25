with open('src/components/SamplerVoicePanel.tsx', 'r') as f:
    content = f.read()

content = content.replace("import { HardwareModule, type KnobConfig } from './HardwareModule';",
                          "import { HardwareModule } from './HardwareModule';")

with open('src/components/SamplerVoicePanel.tsx', 'w') as f:
    f.write(content)
