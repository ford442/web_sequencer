import re

with open('src/App.tsx', 'r') as f:
    content = f.read()

# Insert handleTtsPhraseChange
handler_code = """
    const handleTtsPhraseChange = useCallback((newPhrases: string[]) => {
        setTtsPhrases(newPhrases);
        if (audioEngine?.prepareVocal) {
             const text = newPhrases[activeSamplerBank];
             audioEngine.prepareVocal(activeSamplerBank, text);
        }
    }, [audioEngine, activeSamplerBank]);
"""

# Insert before onSynthAParamChange
if "const onSynthAParamChange =" in content:
    content = content.replace("const onSynthAParamChange =", handler_code + "\n    const onSynthAParamChange =")
    print("Inserted handler")
else:
    print("Could not find onSynthAParamChange")

# Update prop
if "onTtsPhraseChange={setTtsPhrases}" in content:
    content = content.replace("onTtsPhraseChange={setTtsPhrases}", "onTtsPhraseChange={handleTtsPhraseChange}")
    print("Updated prop")
else:
    print("Could not find prop")

with open('src/App.tsx', 'w') as f:
    f.write(content)
