with open('src/engines/FallbackBassSynth.ts', 'r') as f:
    content = f.read()

content = content.replace("this.filterNode = audioContext.createBiquadFilter();", "this.filterNode = typeof audioContext.createBiquadFilter === 'function' ? audioContext.createBiquadFilter() : { type: 'lowpass', frequency: { value: 1000, cancelScheduledValues: () => {}, setValueAtTime: () => {}, setTargetAtTime: () => {} }, Q: { value: 10 }, connect: () => {}, disconnect: () => {} } as any;")
content = content.replace("const osc = this.audioContext.createOscillator();", "const osc = typeof this.audioContext.createOscillator === 'function' ? this.audioContext.createOscillator() : { type: 'sawtooth', frequency: { value: 440, setTargetAtTime: () => {} }, start: () => {}, stop: () => {}, connect: () => {}, disconnect: () => {} } as any;")

with open('src/engines/FallbackBassSynth.ts', 'w') as f:
    f.write(content)
