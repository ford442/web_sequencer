import re

with open('src/components/note-selector/PropertySlider.tsx', 'r') as f:
    content = f.read()

search = """  valueFormatter = (val) => val,"""
replace = """  valueFormatter = (val: number) => val,"""


if search in content:
    content = content.replace(search, replace)
else:
    print("search not found")

with open('src/components/note-selector/PropertySlider.tsx', 'w') as f:
    f.write(content)
