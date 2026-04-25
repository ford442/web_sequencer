with open('src/App.tsx', 'r') as f:
    content = f.read()

content = content.replace(
    "'formantLfoRate' | 'formantLfoDepth' | 'vibratoDepth'",
    "'formantLfoRate' | 'formantLfoDepth' | 'formantEnvAttack' | 'formantEnvDecay' | 'formantEnvAmount' | 'vibratoDepth'"
)

block = """
                            currentFormantLfoRate={contextMenu.track === 'sampler' ? pattern.sampler[activeSamplerBank]?.steps[contextMenu.step]?.formantLfoRate ?? 0 : pattern?.[contextMenu.track]?.steps?.[contextMenu.step]?.formantLfoRate ?? 0}
                            currentFormantLfoDepth={contextMenu.track === 'sampler' ? pattern.sampler[activeSamplerBank]?.steps[contextMenu.step]?.formantLfoDepth ?? 0 : pattern?.[contextMenu.track]?.steps?.[contextMenu.step]?.formantLfoDepth ?? 0}
"""

new_block = block + """
                            currentFormantEnvAttack={contextMenu.track === 'sampler' ? pattern.sampler[activeSamplerBank]?.steps[contextMenu.step]?.formantEnvAttack ?? 0.1 : pattern?.[contextMenu.track]?.steps?.[contextMenu.step]?.formantEnvAttack ?? 0.1}
                            currentFormantEnvDecay={contextMenu.track === 'sampler' ? pattern.sampler[activeSamplerBank]?.steps[contextMenu.step]?.formantEnvDecay ?? 0.5 : pattern?.[contextMenu.track]?.steps?.[contextMenu.step]?.formantEnvDecay ?? 0.5}
                            currentFormantEnvAmount={contextMenu.track === 'sampler' ? pattern.sampler[activeSamplerBank]?.steps[contextMenu.step]?.formantEnvAmount ?? 0 : pattern?.[contextMenu.track]?.steps?.[contextMenu.step]?.formantEnvAmount ?? 0}
"""

content = content.replace(block, new_block)

with open('src/App.tsx', 'w') as f:
    f.write(content)
