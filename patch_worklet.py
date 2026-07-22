import re

with open('src/audio-worklets/rubberband-processor.ts', 'r') as f:
    content = f.read()

# Update getPhonemeStretchRatio to getPhonemeDataAtSample
old_func = """  private getPhonemeStretchRatio(currentSample: number): number {
    if (!this.phonemeData || !this.phonemeRatios) return 1.0;

    const count = this.phonemeData[0];
    // Phoneme data stride is 4 floats: start, end, isVowel, stretch(unused in buffer, used from ratios array)
    for (let i = 0; i < count; i++) {
      const baseIndex = 1 + i * 4;
      const start = this.phonemeData[baseIndex];
      const end = this.phonemeData[baseIndex + 1];

      if (currentSample >= start && currentSample < end) {
        return this.phonemeRatios[i] || 1.0;
      }
    }
    return 1.0;
  }"""

new_func = """  /**
   * Determine the phoneme parameters for the current sample position.
   * Returns [stretchRatio, volume, pitchBend]
   */
  private getPhonemeDataAtSample(currentSample: number): [number, number, number] {
    if (!this.phonemeData || !this.phonemeRatios) return [1.0, 1.0, 0.0];

    const count = this.phonemeData[0];
    // Phoneme data stride is 6 floats: start, end, isVowel, stretch(unused in buffer), volume, pitchBend
    for (let i = 0; i < count; i++) {
      const baseIndex = 1 + i * 6;
      const start = this.phonemeData[baseIndex];
      const end = this.phonemeData[baseIndex + 1];

      if (currentSample >= start && currentSample < end) {
        const ratio = this.phonemeRatios[i] || 1.0;
        const volume = this.phonemeData[baseIndex + 4] !== undefined ? this.phonemeData[baseIndex + 4] : 1.0;
        const pitchBend = this.phonemeData[baseIndex + 5] !== undefined ? this.phonemeData[baseIndex + 5] : 0.0;
        return [ratio, volume, pitchBend];
      }
    }
    return [1.0, 1.0, 0.0];
  }"""

content = content.replace(old_func, new_func)

with open('src/audio-worklets/rubberband-processor.ts', 'w') as f:
    f.write(content)

print("Patched rubberband-processor.ts for getPhonemeDataAtSample")
