def modify_file():
    with open('src/hooks/audioEngine/audioPlayback.ts', 'r') as f:
        lines = f.readlines()

    loop_idx = -1
    for i, line in enumerate(lines):
        if 'for (let i = 0; i < retrigger; i++) {' in line:
            loop_idx = i
            break

    if loop_idx == -1:
        return

    hoist_lines = [
        "        // === HOISTED NOTE RESOLUTION (outside retrigger loop) ===\n",
        "        const noteStr = Array.isArray(note) ? note[0] : note;\n",
        "        if (!noteStr) {\n",
        "            return; // note is invariant, so we can exit early\n",
        "        }\n",
        "        const midi = noteToMidi(noteStr);\n\n"
    ]

    new_lines = lines[:loop_idx] + hoist_lines + lines[loop_idx:]

    final_lines = []
    i = 0
    blocks_removed = 0

    end_idx = -1
    for i_line, line in enumerate(new_lines):
        if 'export const triggerSidechainDuck' in line or 'export function triggerSidechainDuck' in line:
            end_idx = i_line
            break

    if end_idx == -1:
        end_idx = len(new_lines)

    while i < len(new_lines):
        if i >= loop_idx + len(hoist_lines) and i < end_idx and blocks_removed < 5:
            if 'const noteStr = Array.isArray(note) ? note[0] : note;' in new_lines[i]:
                # 6 line variant
                if i + 5 < len(new_lines) and 'const midi = noteToMidi(noteStr);' in new_lines[i+5]:
                    # Keep all lines exactly the same except the inner code!
                    # If we comment them out, it avoids changing the AST at all.
                    for j in range(i, i+6):
                        final_lines.append('// ' + new_lines[j])
                    i += 6
                    blocks_removed += 1
                    continue
                # 5 line variant
                elif i + 4 < len(new_lines) and 'const midi = noteToMidi(noteStr);' in new_lines[i+4]:
                    for j in range(i, i+5):
                        final_lines.append('// ' + new_lines[j])
                    i += 5
                    blocks_removed += 1
                    continue

        final_lines.append(new_lines[i])
        i += 1

    # Append the single missing closing brace that the original file was missing (discovered via linting unpatched file earlier)
    # Actually wait. Let's count properly.
    o = sum(l.count('{') for l in final_lines if not l.startswith('//'))
    c = sum(l.count('}') for l in final_lines if not l.startswith('//'))
    if o > c:
        for _ in range(o - c):
            final_lines.append('}\n')

    with open('src/hooks/audioEngine/audioPlayback.ts', 'w') as f:
        f.writelines(final_lines)

    print(f"Removed {blocks_removed} blocks")

modify_file()
