import re

with open('src/components/note-selector/synthEffectTypes.ts', 'r') as f:
    content = f.read()

content = content.replace("  currentVolumeFilterMod?: number;\n", "  currentVolumeFilterMod?: number;\n  currentPhonemeDelayAmount?: number;\n  currentPhonemeDelayFeedback?: number;\n")

with open('src/components/note-selector/synthEffectTypes.ts', 'w') as f:
    f.write(content)

with open('src/components/note-selector/SynthGranularEffects.tsx', 'r') as f:
    content = f.read()

content = content.replace("    currentVolumeFilterMod = 0,\n", "    currentVolumeFilterMod = 0,\n    currentPhonemeDelayAmount = 0,\n    currentPhonemeDelayFeedback = 0,\n")
content = content.replace("  if (trackType !== \"synth\") return null;", "  if (trackType !== \"synth\" && trackType !== \"voice\") return null;")

sliders_html = """
        <div className="flex justify-between text-[10px] text-cyan-200/70 font-bold uppercase mt-2">
          <label htmlFor="note-phoneme-delay-amount">Phoneme Delay</label>
        </div>
        <PropertySlider
          id="note-phoneme-delay-amount"
          value={currentPhonemeDelayAmount}
          onChange={(v) => onPropertyChange?.("phonemeDelayAmount", v)}
          min={0} max={1} step={0.01}
          format={(v) => `${Math.round(v * 100)}%`}
        />
        <div className="flex justify-between text-[10px] text-cyan-200/70 font-bold uppercase mt-1">
          <label htmlFor="note-phoneme-delay-feedback">Delay Feedback</label>
        </div>
        <PropertySlider
          id="note-phoneme-delay-feedback"
          value={currentPhonemeDelayFeedback}
          onChange={(v) => onPropertyChange?.("phonemeDelayFeedback", v)}
          min={0} max={1} step={0.01}
          format={(v) => `${Math.round(v * 100)}%`}
        />
"""

content = content.replace("      <div className=\"flex flex-col gap-1\">", "      <div className=\"flex flex-col gap-1\">\n" + sliders_html)

with open('src/components/note-selector/SynthGranularEffects.tsx', 'w') as f:
    f.write(content)

with open('src/components/note-selector/types.ts', 'r') as f:
    content = f.read()

content = content.replace("  | \"vocoderRelease\"", "  | \"vocoderRelease\"\n  | \"phonemeDelayAmount\"\n  | \"phonemeDelayFeedback\"")
content = content.replace("  currentVolumeFilterMod?: number;", "  currentVolumeFilterMod?: number;\n  currentPhonemeDelayAmount?: number;\n  currentPhonemeDelayFeedback?: number;")

with open('src/components/note-selector/types.ts', 'w') as f:
    f.write(content)
