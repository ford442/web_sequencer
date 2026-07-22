import re

with open('src/audio-worklets/rubberband-processor.ts', 'r') as f:
    content = f.read()

old_process = """        outputChannel.set(outputView);
        this.expressiveProcessor.process(outputChannel, outputChannel);      // Apply Rhythmic Gating (Trance Gate)
      const gateDepth = parameters.gateDepth ? parameters.gateDepth[0] : 0.0;"""

new_process = """        outputChannel.set(outputView);
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
      const gateDepth = parameters.gateDepth ? parameters.gateDepth[0] : 0.0;"""

content = content.replace(old_process, new_process)

with open('src/audio-worklets/rubberband-processor.ts', 'w') as f:
    f.write(content)

print("Patched rubberband-processor.ts for volume")
