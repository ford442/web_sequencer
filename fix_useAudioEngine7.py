import re

with open('src/hooks/useAudioEngine.ts', 'r') as f:
    content = f.read()

# Let's add a closing bracket before `return useMemo(() => ({`

content = content.replace(
    '    return useMemo(() => ({',
    '    return useMemo(() => ({\n'
)

with open('src/hooks/useAudioEngine.ts', 'w') as f:
    f.write(content)
