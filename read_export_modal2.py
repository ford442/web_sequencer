with open("src/components/ExportModal.tsx", "r") as f:
    lines = f.readlines()

# print everything from line 200 onwards
for i in range(200, min(200 + 100, len(lines))):
    print(lines[i].rstrip('\n'))
