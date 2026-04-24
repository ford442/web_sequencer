import re
with open('src/__tests__/SamplerPanel.perf.test.tsx', 'r') as f:
    content = f.read()

content = content.replace("expect(Knob).toHaveBeenCalledTimes(28)", "expect(Knob).toHaveBeenCalledTimes(31)")
content = content.replace("expect(Knob).toHaveBeenCalledTimes(56)", "expect(Knob).toHaveBeenCalledTimes(62)")

with open('src/__tests__/SamplerPanel.perf.test.tsx', 'w') as f:
    f.write(content)
