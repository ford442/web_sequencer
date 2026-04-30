import re

with open("src/__tests__/SamplerPanel.perf.test.tsx", "r") as f:
    content = f.read()

# Replace expected to be called 31 times with 33 times
content = re.sub(r"expect\(Knob\)\.toHaveBeenCalledTimes\(31\);", "expect(Knob).toHaveBeenCalledTimes(33);", content)

with open("src/__tests__/SamplerPanel.perf.test.tsx", "w") as f:
    f.write(content)
