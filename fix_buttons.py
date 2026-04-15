import re

def fix_file(filepath):
    with open(filepath, 'r') as f:
        content = f.read()

    button_matches = re.finditer(r'<button([^>]*)>', content)

    offset = 0
    new_content = content

    for match in button_matches:
        tag = match.group(0)
        inner_attrs = match.group(1)

        # Skip if it already has an aria-label
        if 'aria-label=' in inner_attrs:
            continue

        label = "Button"

        if 'onSetIsSongModeActive' in inner_attrs:
             label = "{isSongModeActive ? \\'Loop Song Mode Active\\' : \\'Loop Pattern Mode Active\\'}"
        elif 'onExportXM' in inner_attrs:
             label = "Export as XM file"
        elif 'onSetBackgroundImage' in inner_attrs:
             label = "Clear Background Image"

        # Skip generic ones where we don't have a good guess (to avoid generic "Button" labels everywhere)
        if label == "Button":
             continue

        # Insert aria-label
        insertion_point = tag.rfind('>')
        if label.startswith('{'):
            new_tag = tag[:insertion_point] + f' aria-label={label}' + tag[insertion_point:]
        else:
            new_tag = tag[:insertion_point] + f' aria-label="{label}"' + tag[insertion_point:]

        match_start = match.start() + offset
        match_end = match.end() + offset

        new_content = new_content[:match_start] + new_tag + new_content[match_end:]
        offset += len(new_tag) - len(tag)

    if content != new_content:
        with open(filepath, 'w') as f:
            f.write(new_content)
        print(f"Fixed buttons in {filepath}")

files_to_fix = [
    'src/components/SongMode.tsx'
]

for file in files_to_fix:
    fix_file(file)
