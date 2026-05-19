import re
with open('src/__tests__/Open303Config.test.ts', 'r') as f:
    content = f.read()

mock_audio_context = """        mockAudioContext = {
            createGain: vi.fn(() => ({
                connect: vi.fn(),
                disconnect: vi.fn(),
                gain: { value: 1.0 }
            })),
            createBiquadFilter: vi.fn(() => ({
                connect: vi.fn(),
                disconnect: vi.fn(),
                type: 'lowpass',
                frequency: { value: 1000 },
                Q: { value: 10 }
            })),
            sampleRate: 44100,
            audioWorklet: {
                addModule: vi.fn().mockResolvedValue(undefined)
            }
        } as any;"""

content = re.sub(r'mockAudioContext\s*=\s*{.*?audioWorklet.*?} as any;', mock_audio_context, content, flags=re.MULTILINE|re.DOTALL)

with open('src/__tests__/Open303Config.test.ts', 'w') as f:
    f.write(content)
