import sys

with open('src/components/NoteSelector.tsx', 'r') as f:
    content = f.read()

# I see handleSliderChange used to exist, let's find the proper function.
# Look for onPropertyChange calls
content = content.replace("onChange={(e) => update(e.target.dataset.property as any, e)}", "onChange={(e) => onPropertyChange?.(e.target.dataset.property as any, parseFloat(e.target.value))}")

with open('src/components/NoteSelector.tsx', 'w') as f:
    f.write(content)
