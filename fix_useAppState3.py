import re

file_path = 'src/hooks/useAppState.tsx'

with open(file_path, 'r') as f:
    content = f.read()

# Fix the duplicate return block in useAppState.tsx
# Find the exact duplicate lines
dup_pattern = r'        globalMacro1, setGlobalMacro1,\n        globalMacro2, setGlobalMacro2,\n        globalMacro3, setGlobalMacro3,\n        globalMacro4, setGlobalMacro4,\n        globalMacro1, setGlobalMacro1,\n        globalMacro2, setGlobalMacro2,\n        globalMacro3, setGlobalMacro3,\n        globalMacro4, setGlobalMacro4,\n'
replacement = '        globalMacro1, setGlobalMacro1,\n        globalMacro2, setGlobalMacro2,\n        globalMacro3, setGlobalMacro3,\n        globalMacro4, setGlobalMacro4,\n'

content = content.replace('        globalMacro1, setGlobalMacro1,\n        globalMacro1, setGlobalMacro1,\n', '        globalMacro1, setGlobalMacro1,\n')
content = content.replace('        globalMacro2, setGlobalMacro2,\n        globalMacro2, setGlobalMacro2,\n', '        globalMacro2, setGlobalMacro2,\n')
content = content.replace('        globalMacro3, setGlobalMacro3,\n        globalMacro3, setGlobalMacro3,\n', '        globalMacro3, setGlobalMacro3,\n')
content = content.replace('        globalMacro4, setGlobalMacro4,\n        globalMacro4, setGlobalMacro4,\n', '        globalMacro4, setGlobalMacro4,\n')

with open(file_path, 'w') as f:
    f.write(content)
