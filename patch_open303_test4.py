import re

with open('src/__tests__/Open303Config.test.ts', 'r') as f:
    content = f.read()

# We need to correctly mock createOscillator in the original file, it was just missing createBiquadFilter and createOscillator

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

content = re.sub(r'mockAudioContext\s*=\s*{.*?audioWorklet.*?} as any;', mock_audio_context, content, flags=re.MULTILINE|re.DOTALL)

with open('src/__tests__/Open303Config.test.ts', 'w') as f:
    f.write(content)
