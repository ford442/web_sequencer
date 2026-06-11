import re

with open('src/hooks/useAudioEngine.ts', 'r') as f:
    content = f.read()

# Fix params as any to avoid TS errors
content = content.replace("params.formantEnvSync ?? false", "(params as any).formantEnvSync ?? false")
content = content.replace("params.formantEnvAttack ?? 0", "(params as any).formantEnvAttack ?? 0")
content = content.replace("params.formantEnvDecay ?? 0", "(params as any).formantEnvDecay ?? 0")
content = content.replace("params.formantEnvAmount ?? 0", "(params as any).formantEnvAmount ?? 0")

with open('src/hooks/useAudioEngine.ts', 'w') as f:
    f.write(content)
