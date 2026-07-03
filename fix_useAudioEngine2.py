with open('src/hooks/useAudioEngine.ts', 'r') as f:
    lines = f.readlines()

def check_brackets():
    stack = []
    for i, line in enumerate(lines):
        for j, char in enumerate(line):
            if char == '{':
                stack.append((i, j))
            elif char == '}':
                if stack:
                    stack.pop()
                else:
                    print(f"Extra closing bracket at line {i+1}")
    print("Unclosed brackets:")
    for b in stack:
        print(f"Line {b[0]+1}: {lines[b[0]].strip()}")

check_brackets()
