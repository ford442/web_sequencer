with open("src/components/ExportModal.tsx", "r") as f:
    lines = f.readlines()

# print everything from line 140 onwards
for i in range(140, min(140 + 60, len(lines))):
    print(lines[i].rstrip('\n'))
