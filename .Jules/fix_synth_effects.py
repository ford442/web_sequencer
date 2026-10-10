import re

with open('src/components/note-selector/SynthGranularEffects.tsx', 'r') as f:
    content = f.read()

# Replace format with valueFormatter and add missing label prop, remove the duplicate labels because PropertySlider renders its own label
# the original code I added:
"""
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
"""
# I need to replace it.
new_sliders = """
        <PropertySlider
          id="note-phoneme-delay-amount"
          label="Phoneme Delay"
          value={currentPhonemeDelayAmount}
          onChange={(v: number) => onPropertyChange?.("phonemeDelayAmount", v)}
          min={0} max={1} step={0.01}
          valueFormatter={(v: number) => `${Math.round(v * 100)}%`}
        />
        <PropertySlider
          id="note-phoneme-delay-feedback"
          label="Delay Feedback"
          value={currentPhonemeDelayFeedback}
          onChange={(v: number) => onPropertyChange?.("phonemeDelayFeedback", v)}
          min={0} max={1} step={0.01}
          valueFormatter={(v: number) => `${Math.round(v * 100)}%`}
        />
"""

content = re.sub(r'<div className="flex justify-between text-\[10px\] text-cyan-200/70 font-bold uppercase mt-2">.*?<label htmlFor="note-phoneme-delay-amount">Phoneme Delay</label>.*?</div>.*?<PropertySlider.*?id="note-phoneme-delay-amount".*?/>', "", content, flags=re.DOTALL)
content = re.sub(r'<div className="flex justify-between text-\[10px\] text-cyan-200/70 font-bold uppercase mt-1">.*?<label htmlFor="note-phoneme-delay-feedback">Delay Feedback</label>.*?</div>.*?<PropertySlider.*?id="note-phoneme-delay-feedback".*?/>', "", content, flags=re.DOTALL)

content = content.replace("      <div className=\"flex flex-col gap-1\">", "      <div className=\"flex flex-col gap-1\">\n" + new_sliders)

with open('src/components/note-selector/SynthGranularEffects.tsx', 'w') as f:
    f.write(content)
