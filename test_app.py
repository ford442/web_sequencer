with open('src/App.tsx', 'r') as f:
    content = f.read()

idx_currentStepRef = content.find("const currentStepRef = useRef(-1);")
idx_handleKeyboardPlay = content.find("const handleKeyboardPlay = useCallback((note: string) => {")
print(f"currentStepRef: {idx_currentStepRef}, handleKeyboardPlay: {idx_handleKeyboardPlay}")
