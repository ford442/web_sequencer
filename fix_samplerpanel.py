import re

file_path = 'src/components/SamplerPanel.tsx'

with open(file_path, 'r') as f:
    content = f.read()

# Remove the duplicated component code at the bottom of SamplerPanel.tsx
# The issue is that there's a component return and then immediately another set of hooks and returns.
# Let's find where the duplicate starts and trim it.
# Look for "  const fileInputRef = useRef<HTMLInputElement>(null);"

parts = content.split("  const fileInputRef = useRef<HTMLInputElement>(null);")

if len(parts) > 1:
    # Just keep the first part and close it if necessary
    # Let's check how the component is closed. The first part ends with `    );\n`
    new_content = parts[0] + "});\n\nexport { SamplerPanelComponent as SamplerPanel };\n"
    with open(file_path, 'w') as f:
        f.write(new_content)
        print("Fixed SamplerPanel.tsx")
