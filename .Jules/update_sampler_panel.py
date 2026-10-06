import re

with open('src/components/sampler-panel/SamplerKnobControls.tsx', 'r') as f:
    content = f.read()

content = content.replace("  vocalChorus: (v: number) => void;", "  vocalChorus: (v: number) => void;\n  phonemeDelayAmount: (v: number) => void;\n  phonemeDelayFeedback: (v: number) => void;")

knobs_html = """          <Knob label="Phon Delay" value={currentParams.phonemeDelayAmount || 0} onChange={handlers.phonemeDelayAmount} min={0} max={1.0} step={0.01} color="indigo" unit="%" />
          <Knob label="Phon F.Back" value={currentParams.phonemeDelayFeedback || 0} onChange={handlers.phonemeDelayFeedback} min={0} max={1.0} step={0.01} color="indigo" unit="%" />
"""
content = content.replace("          <Knob label=\"Chorus\"", knobs_html + "          <Knob label=\"Chorus\"")

with open('src/components/sampler-panel/SamplerKnobControls.tsx', 'w') as f:
    f.write(content)

with open('src/hooks/appState/useSamplerPanelState.ts', 'r') as f:
    content = f.read()

content = content.replace("      vocalChorus: (v) => handleParamChange('vocalChorus', v),", "      vocalChorus: (v) => handleParamChange('vocalChorus', v),\n      phonemeDelayAmount: (v) => handleParamChange('phonemeDelayAmount', v),\n      phonemeDelayFeedback: (v) => handleParamChange('phonemeDelayFeedback', v),")

with open('src/hooks/appState/useSamplerPanelState.ts', 'w') as f:
    f.write(content)
