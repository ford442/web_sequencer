with open('src/engines/SingingVoice.ts', 'r') as f:
    content = f.read()

content = content.replace("let timeoutId: ReturnType<typeof setTimeout> | undefined;\n                timeoutId = setTimeout(() => { reject(new Error('timeout')); }, 5000);", "const timeoutId = setTimeout(() => reject(new Error('timeout')), 5000);")

with open('src/engines/SingingVoice.ts', 'w') as f:
    f.write(content)
