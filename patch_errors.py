with open('src/App.tsx', 'r') as f:
    content = f.read()

content = content.replace("currentFormantEnvAttack={contextMenu.track === 'sampler' ? pattern.sampler[activeSamplerBank]?.steps[contextMenu.step]?.formantEnvAttack ?? 0.1 : pattern?.[contextMenu.track]?.steps?.[contextMenu.step]?.formantEnvAttack ?? 0.1}", "")
content = content.replace("currentFormantEnvDecay={contextMenu.track === 'sampler' ? pattern.sampler[activeSamplerBank]?.steps[contextMenu.step]?.formantEnvDecay ?? 0.5 : pattern?.[contextMenu.track]?.steps?.[contextMenu.step]?.formantEnvDecay ?? 0.5}", "")
content = content.replace("currentFormantEnvAmount={contextMenu.track === 'sampler' ? pattern.sampler[activeSamplerBank]?.steps[contextMenu.step]?.formantEnvAmount ?? 0 : pattern?.[contextMenu.track]?.steps?.[contextMenu.step]?.formantEnvAmount ?? 0}", "")

with open('src/App.tsx', 'w') as f:
    f.write(content)

with open('src/components/NoteSelector.tsx', 'r') as f:
    content = f.read()

content = content.replace("currentFormantEnvAttack = 0.1, currentFormantEnvDecay = 0.5, currentFormantEnvAmount = 0,", "")

with open('src/components/NoteSelector.tsx', 'w') as f:
    f.write(content)

with open('src/components/SamplerPanel.tsx', 'r') as f:
    content = f.read()

content = content.replace("const handleFormantEnvAttackChange = paramHandlers.formantEnvAttack;", "const handleFormantEnvAttackChange = (v: number) => { updateParam('formantEnvAttack', v); };")
content = content.replace("const handleFormantEnvDecayChange = paramHandlers.formantEnvDecay;", "const handleFormantEnvDecayChange = (v: number) => { updateParam('formantEnvDecay', v); };")
content = content.replace("const handleFormantEnvAmountChange = paramHandlers.formantEnvAmount;", "const handleFormantEnvAmountChange = (v: number) => { updateParam('formantEnvAmount', v); };")

with open('src/components/SamplerPanel.tsx', 'w') as f:
    f.write(content)
