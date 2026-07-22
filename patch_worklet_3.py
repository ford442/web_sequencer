import re

with open('src/audio-worklets/rubberband-processor.ts', 'r') as f:
    content = f.read()

# Update finalPitch with phoneme pitch bend and output channel with phoneme volume

# 1. We need to extract the phoneme data at the start of the block or per sample?
# Because rubberBand processes blocks, we can extract it for the block. We are already extracting it for stretch ratio.
old_ratio = """        // Calculate dynamic time ratio based on phoneme data
        let ratio = defaultTimeRatio;
        if (this.phonemeData && this.phonemeRatios) {
          // Temp replacement for now
          const [pRatio, pVol, pBend] = this.getPhonemeDataAtSample(this.currentSamplePtr);
          ratio = pRatio;
        }"""

new_ratio = """        // Calculate dynamic time ratio based on phoneme data
        let ratio = defaultTimeRatio;
        let phonemeVolume = 1.0;
        let phonemePitchBendCents = 0.0;
        if (this.phonemeData && this.phonemeRatios) {
          const [pRatio, pVol, pBend] = this.getPhonemeDataAtSample(this.currentSamplePtr);
          ratio = pRatio;
          phonemeVolume = pVol;
          phonemePitchBendCents = pBend;
        }"""

content = content.replace(old_ratio, new_ratio)

# 2. Add phoneme pitch bend to final pitch calculation
old_granular = """    if (granularPitchShift !== 0.0) {
      const pitchShiftRatio = Math.pow(2.0, granularPitchShift / 12.0);
      finalPitch *= pitchShiftRatio;
    }"""

new_granular = """    if (granularPitchShift !== 0.0) {
      const pitchShiftRatio = Math.pow(2.0, granularPitchShift / 12.0);
      finalPitch *= pitchShiftRatio;
    }

    // Apply Phoneme Pitch Bend (if we're streaming from a buffer and have it calculated)
    if (this.isPlaying && this.fullSampleBuffer && this.phonemeData && this.phonemeRatios) {
        const [_, _vol, pBend] = this.getPhonemeDataAtSample(this.currentSamplePtr);
        if (pBend !== 0.0) {
            const pitchBendRatio = Math.pow(2.0, pBend / 1200.0);
            finalPitch *= pitchBendRatio;
        }
    }"""

content = content.replace(old_granular, new_granular)

# 3. Apply volume after expressiveProcessor
old_process = """      if (outputChannel) {
        this.expressiveProcessor.process(outputChannel, outputChannel);      // Apply Rhythmic Gating (Trance Gate)
        if (gateDepth > 0) {"""

new_process = """      if (outputChannel) {
        this.expressiveProcessor.process(outputChannel, outputChannel);

        // Apply phoneme volume
        if (this.isPlaying && this.fullSampleBuffer && this.phonemeData && this.phonemeRatios) {
            const [_, pVol, _pBend] = this.getPhonemeDataAtSample(this.currentSamplePtr);
            if (pVol !== 1.0) {
                for (let i = 0; i < outputChannel.length; i++) {
                    outputChannel[i] *= pVol;
                }
            }
        }

        // Apply Rhythmic Gating (Trance Gate)
        if (gateDepth > 0) {"""

content = content.replace(old_process, new_process)

with open('src/audio-worklets/rubberband-processor.ts', 'w') as f:
    f.write(content)

print("Patched rubberband-processor.ts for process loop")
