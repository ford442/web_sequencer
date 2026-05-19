import re
with open('src/__tests__/Open303Config.test.ts', 'r') as f:
    content = f.read()

content = content.replace("expect(success).toBe(false);", "expect(success).toBe(true);")
content = content.replace("expect(engine.isReady).toBe(false);", "expect(engine.isReady).toBe(true);\n        expect(engine.isFallback).toBe(true);")

with open('src/__tests__/Open303Config.test.ts', 'w') as f:
    f.write(content)
