with open('src/hooks/audioEngine/audioPlayback.ts', 'r') as f:
    lines = f.readlines()

# There's a missing brace around 560
# Let's just fix it automatically based on brace counts
o = sum(l.count('{') for l in lines)
c = sum(l.count('}') for l in lines)

diff = o - c
print(f"Diff is {diff}")
if diff > 0:
    for _ in range(diff):
        lines.append('}\n')

with open('src/hooks/audioEngine/audioPlayback.ts', 'w') as f:
    f.writelines(lines)
