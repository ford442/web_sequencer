import re
with open('src/__tests__/App.test.tsx', 'r') as f:
    content = f.read()

content = content.replace("import initOscillators from '../wasm/oscillators.wasm?init';", "import initOscillators from '../wasm/oscillators.wasm?init';\nvi.mock('../wasm/oscillators.wasm?init', () => ({\n  default: vi.fn().mockResolvedValue({})\n}));")

with open('src/__tests__/App.test.tsx', 'w') as f:
    f.write(content)
