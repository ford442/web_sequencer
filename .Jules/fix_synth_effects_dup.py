import re

with open('src/components/note-selector/SynthGranularEffects.tsx', 'r') as f:
    content = f.read()

# First, remove ALL the inserted phoneme delay sliders
pattern = r'<PropertySlider\s+id="note-phoneme-delay-amount"[\s\S]*?/>\s*<PropertySlider\s+id="note-phoneme-delay-feedback"[\s\S]*?/>\n?'
content = re.sub(pattern, "", content)

# Now insert them carefully ONCE at the top of the grid
# Wait, SynthGranularEffects has multiple columns. Let's insert it inside the first column, which starts around line 68.
# Actually, the file has multiple <div className="flex flex-col gap-1"> but I only want to insert it once.
content = content.replace(
    '  if (trackType !== "synth" && trackType !== "voice") return null;\n\n  return (\n    <>\n      <div className="flex flex-col gap-1">',
    '  if (trackType !== "synth" && trackType !== "voice") return null;\n\n  return (\n    <>\n      <div className="flex flex-col gap-1">\n' +
    """        <PropertySlider
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
)

with open('src/components/note-selector/SynthGranularEffects.tsx', 'w') as f:
    f.write(content)

# Fix module-size-budget.md table format
with open('docs/refactoring/module-size-budget.md', 'r') as f:
    content = f.read()

content = content.replace(
    "| `src/audio-worklets/rubberband-processor.ts` | Adding PhonemeDelayEffect |",
    "| `src/audio-worklets/rubberband-processor.ts` | Adding PhonemeDelayEffect |\n| `src/components/note-selector/SynthGranularEffects.tsx` | Added UI |"
)
# Make sure it's valid markdown. Actually earlier I corrupted it. Let me just restore the file using git checkout and do it properly.
