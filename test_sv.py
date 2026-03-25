import re

with open('src/components/SamplerVoicePanel.tsx', 'r') as f:
    content = f.read()

content = content.replace("import { HardwareModule, type KnobConfig } from './HardwareModule';",
                          "import { HardwareModule, type KnobConfig } from './HardwareModule';")

content = content.replace("import { HardwareModule, type KnobConfig }", "import { HardwareModule, KnobConfig }")

with open('src/components/SamplerVoicePanel.tsx', 'w') as f:
    f.write(content)
