import re

with open('src/hooks/useAudioEngine.ts', 'r') as f:
    content = f.read()

# Fix noteParams TS errors
content = content.replace("noteParams?.formantEnvSync", "(noteParams as any)?.formantEnvSync")
content = content.replace("noteParams?.formantEnvAttack", "(noteParams as any)?.formantEnvAttack")
content = content.replace("noteParams?.formantEnvDecay", "(noteParams as any)?.formantEnvDecay")
content = content.replace("noteParams?.formantEnvAmount", "(noteParams as any)?.formantEnvAmount")

with open('src/hooks/useAudioEngine.ts', 'w') as f:
    f.write(content)
