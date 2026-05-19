import re
with open('src/__tests__/Open303Config.test.ts', 'r') as f:
    content = f.read()

# Change the mocked fetch buffer size to > 1024 so it doesn't trigger the stub fallback
content = re.sub(r'new ArrayBuffer\(8\)', r'new ArrayBuffer(2048)', content)

with open('src/__tests__/Open303Config.test.ts', 'w') as f:
    f.write(content)
