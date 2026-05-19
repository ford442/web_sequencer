import re
with open('src/engines/SingingVoice.ts', 'r') as f:
    content = f.read()

# Fix the handler initialization to correctly use `let`
# Reverting to the old structure and doing it right.

content = content.replace("const timeoutId = setTimeout(() => reject(new Error('timeout')), 5000);", "let timeoutId: ReturnType<typeof setTimeout> | undefined;\n                timeoutId = setTimeout(() => { reject(new Error('timeout')); }, 5000);")


with open('src/engines/SingingVoice.ts', 'w') as f:
    f.write(content)
