import os

with open('src/__tests__/audioExport.perf.test.ts', 'r') as f:
    content = f.read()
if 'vi.mock("../wasm/audioExport.wasm?init"' not in content:
    content = content.replace('import initAudioExport from "../wasm/audioExport.wasm?init";', 'import initAudioExport from "../wasm/audioExport.wasm?init";\nvi.mock("../wasm/audioExport.wasm?init", () => ({ default: vi.fn().mockResolvedValue({}) }));')
with open('src/__tests__/audioExport.perf.test.ts', 'w') as f:
    f.write(content)

with open('src/__tests__/audioExport.test.ts', 'r') as f:
    content = f.read()
if 'vi.mock("../wasm/audioExport.wasm?init"' not in content:
    content = content.replace('import initAudioExport from "../wasm/audioExport.wasm?init";', 'import initAudioExport from "../wasm/audioExport.wasm?init";\nvi.mock("../wasm/audioExport.wasm?init", () => ({ default: vi.fn().mockResolvedValue({}) }));')
with open('src/__tests__/audioExport.test.ts', 'w') as f:
    f.write(content)

with open('src/__tests__/trackFreezer.test.ts', 'r') as f:
    content = f.read()
if 'vi.mock("../wasm/trackFreezer.wasm?init"' not in content:
    content = content.replace('import initTrackFreezer from "../wasm/trackFreezer.wasm?init";', 'import initTrackFreezer from "../wasm/trackFreezer.wasm?init";\nvi.mock("../wasm/trackFreezer.wasm?init", () => ({ default: vi.fn().mockResolvedValue({}) }));')
with open('src/__tests__/trackFreezer.test.ts', 'w') as f:
    f.write(content)

with open('src/utils/__tests__/fft.spec.ts', 'r') as f:
    content = f.read()
if 'vi.mock("../wasm/fft.wasm?init"' not in content:
    content = content.replace('import initFFT from "../wasm/fft.wasm?init";', 'import initFFT from "../wasm/fft.wasm?init";\nvi.mock("../wasm/fft.wasm?init", () => ({ default: vi.fn().mockResolvedValue({}) }));')
with open('src/utils/__tests__/fft.spec.ts', 'w') as f:
    f.write(content)

with open('src/engines/rubberband/__tests__/ArtifactDetector.spec.ts', 'r') as f:
    content = f.read()
if 'vi.mock("../wasm/fft.wasm?init"' not in content:
    content = content.replace('import initFFT from "../wasm/fft.wasm?init";', 'import initFFT from "../wasm/fft.wasm?init";\nvi.mock("../wasm/fft.wasm?init", () => ({ default: vi.fn().mockResolvedValue({}) }));')
with open('src/engines/rubberband/__tests__/ArtifactDetector.spec.ts', 'w') as f:
    f.write(content)

with open('src/__tests__/WasmOscillator.test.ts', 'r') as f:
    content = f.read()
if 'vi.mock("../wasm/oscillators.wasm?init"' not in content:
    content = content.replace('import initOscillators from "../wasm/oscillators.wasm?init";', 'import initOscillators from "../wasm/oscillators.wasm?init";\nvi.mock("../wasm/oscillators.wasm?init", () => ({ default: vi.fn().mockResolvedValue({}) }));')
with open('src/__tests__/WasmOscillator.test.ts', 'w') as f:
    f.write(content)
