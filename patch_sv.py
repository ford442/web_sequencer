with open('src/components/SamplerVoicePanel.tsx', 'r') as f:
    content = f.read()

if "import { HardwareModule" not in content:
    content = content.replace("import { type HarmonizerConfig } from '../engines/Harmonizer';",
                              "import { type HarmonizerConfig } from '../engines/Harmonizer';\nimport { HardwareModule, type KnobConfig } from './HardwareModule';")

    with open('src/components/SamplerVoicePanel.tsx', 'w') as f:
        f.write(content)
