with open('src/hooks/useAudioEngine.ts', 'r') as f:
    content = f.read()

# Let's add a closing bracket at the end of the file.
content += '\n}\n'

with open('src/hooks/useAudioEngine.ts', 'w') as f:
    f.write(content)
