with open('src/components/SamplerPitchControls.tsx', 'r') as f:
    lines = f.readlines()

new_lines = []
skip = False
for line in lines:
    if "attack?: number;" in line or "decay?: number;" in line:
        continue
    new_lines.append(line)
    if "pitchAttack?: number;" in line:
        new_lines.append("  attack?: number;\n")
        new_lines.append("  decay?: number;\n")

with open('src/components/SamplerPitchControls.tsx', 'w') as f:
    f.writelines(new_lines)
