import re

with open('src/App.tsx', 'r') as f:
    content = f.read()

original_str = "const handleLoadSample = useCallback((name: string, buffer: AudioBuffer) => { if (!audioEngine) return; audioEngine.loadSampleToEngine(name, buffer); setSampleBuffers(prev => { const next = [...prev]; next[activeSamplerBank] = buffer; return next; }); const bankName = `bank_${activeSamplerBank}`; setSampler(prev => { const newParams = [...prev]; newParams[activeSamplerBank] = { ...newParams[activeSamplerBank], sampleName: bankName }; return newParams; }); }, [audioEngine, activeSamplerBank]);"

replacement = """const handleLoadSample = useCallback((name: string, buffer: AudioBuffer) => {
        if (!audioEngine) return;
        audioEngine.loadSampleToEngine(name, buffer);
        setSampleBuffers(prev => { const next = [...prev]; next[activeSamplerBank] = buffer; return next; });
        const bankName = `bank_${activeSamplerBank}`;
        setSampler(prev => { const newParams = [...prev]; newParams[activeSamplerBank] = { ...newParams[activeSamplerBank], sampleName: bankName }; return newParams; });

        if (audioEngine.prepareVocal) {
            const text = ttsPhrases[activeSamplerBank] || "Hello World";
            audioEngine.prepareVocal(activeSamplerBank, text);
        }
    }, [audioEngine, activeSamplerBank, ttsPhrases]);"""

if original_str in content:
    content = content.replace(original_str, replacement)
    print("Replaced handleLoadSample")
else:
    print("Could not find exact match, attempting loose match")
    # Use regex to find the function, assuming it starts with const handleLoadSample
    # and ends with [audioEngine, activeSamplerBank]);
    pattern = r"const handleLoadSample = useCallback\(\(name: string, buffer: AudioBuffer\) => \{.*?\}, \[audioEngine, activeSamplerBank\]\);"
    match = re.search(pattern, content, re.DOTALL)
    if match:
        print("Found regex match")
        content = content.replace(match.group(0), replacement)
    else:
        print("Regex failed too")

        # Debug: print snippet of content around where we expect it
        idx = content.find("const handleLoadSample")
        if idx != -1:
            print("Snippet found in file:")
            print(content[idx:idx+500])
        else:
            print("Snippet start NOT found")
        exit(1)

with open('src/App.tsx', 'w') as f:
    f.write(content)
