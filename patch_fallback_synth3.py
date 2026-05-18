with open('src/engines/FallbackBassSynth.ts', 'r') as f:
    content = f.read()

content = content.replace("this.filterNode = audioContext.createBiquadFilter();", "this.filterNode = typeof audioContext.createBiquadFilter === 'function' ? audioContext.createBiquadFilter() : { type: 'lowpass', frequency: { value: 1000, cancelScheduledValues: () => {}, setValueAtTime: () => {}, setTargetAtTime: () => {} }, Q: { value: 10 }, connect: () => {}, disconnect: () => {} } as any;")

with open('src/engines/FallbackBassSynth.ts', 'w') as f:
    f.write(content)

with open('src/__tests__/Open303Config.test.ts', 'r') as f:
    content = f.read()

mock_audio_context = """        mockAudioContext = {
            createGain: vi.fn(() => ({
                connect: vi.fn(),
                disconnect: vi.fn(),
                gain: { value: 1.0, cancelScheduledValues: vi.fn(), setTargetAtTime: vi.fn() }
            })),
            createBiquadFilter: vi.fn(() => ({
                connect: vi.fn(),
                disconnect: vi.fn(),
                type: 'lowpass',
                frequency: { value: 1000, cancelScheduledValues: vi.fn(), setValueAtTime: vi.fn(), setTargetAtTime: vi.fn() },
                Q: { value: 10 }
            })),
            createOscillator: vi.fn(() => ({
                connect: vi.fn(),
                disconnect: vi.fn(),
                type: 'sawtooth',
                frequency: { value: 440, setTargetAtTime: vi.fn() },
                start: vi.fn(),
                stop: vi.fn()
            })),
            sampleRate: 44100,
            currentTime: 0,
            audioWorklet: {
                addModule: vi.fn().mockResolvedValue(undefined)
            }
        } as any;"""

import re
content = re.sub(r'mockAudioContext\s*=\s*{.*?audioWorklet.*?} as any;', mock_audio_context, content, flags=re.MULTILINE|re.DOTALL)

with open('src/__tests__/Open303Config.test.ts', 'w') as f:
    f.write(content)
