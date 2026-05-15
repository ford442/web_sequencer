with open('src/components/SamplerPitchControls.tsx', 'r') as f:
    text = f.read()

# Verify that there are no duplicate properties in SamplerPanel.tsx
with open('src/components/SamplerPanel.tsx', 'r') as f:
    panel_text = f.read()

panel_text = panel_text.replace("gateDepth={currentParams.gateDepth ?? 0}", "")
panel_text = panel_text.replace("gateRate={currentParams.gateRate ?? 4.0}", "")

with open('src/components/SamplerPanel.tsx', 'w') as f:
    f.write(panel_text)
