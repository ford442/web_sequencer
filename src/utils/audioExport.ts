// @mode: typescript
// @migrate-target: assemblyscript
// @perf-bottleneck: Hot loop in audioBufferToWav - sample clamping and conversion
// @future-plan: Move the sample conversion loop to WASM for better performance on large exports
// @note-for-ai: The while loop (lines 33-43) is the hot path. Consider:
// - Creating assembly/audioExport.ts with a convertSamples(buffer, output) function
// - Input: Float32Array of audio samples
// - Output: Direct memory writes of Int16 PCM data

export function audioBufferToWav(buffer: AudioBuffer): Blob {
  const numOfChan = buffer.numberOfChannels;
  const length = buffer.length * numOfChan * 2 + 44;
  const out = new ArrayBuffer(length);
  const view = new DataView(out);
  const channels = [];
  let offset = 0;
  let pos = 0;

  // Write WAV Header
  setUint32(0x46464952); // "RIFF"
  setUint32(length - 8); // file length - 8
  setUint32(0x45564157); // "WAVE"

  setUint32(0x20746d66); // "fmt " chunk
  setUint32(16); // length = 16
  setUint16(1); // PCM (uncompressed)
  setUint16(numOfChan);
  setUint32(buffer.sampleRate);
  setUint32(buffer.sampleRate * 2 * numOfChan); // avg. bytes/sec
  setUint16(numOfChan * 2); // block-align
  setUint16(16); // 16-bit (hardcoded in this encoder)

  setUint32(0x61746164); // "data" - chunk
  setUint32(length - pos - 4); // chunk length

  // Write Interleaved Data
  for (let i = 0; i < buffer.numberOfChannels; i++)
    channels.push(buffer.getChannelData(i));

  // @perf-optimized: Use Int16Array for direct memory access (avoiding DataView overhead)
  // Also fixes a bug where 'pos' (starting at 44) was used as sample index, skipping first 44 samples.
  const isLittleEndian = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
  const len = buffer.length;

  if (isLittleEndian) {
    const sampleData = new Int16Array(out, 44);
    let outputIndex = 0;

    // OPTIMIZATION: Unroll loops for common Mono and Stereo cases
    // This avoids repeated array lookups and branch checks in the hot loop
    if (numOfChan === 2) {
      const ch0 = channels[0];
      const ch1 = channels[1];
      for (let i = 0; i < len; i++) {
        let s = ch0[i];
        // Clamp & Scale Left
        if (s > 1.0) s = 1.0; else if (s < -1.0) s = -1.0;
        sampleData[outputIndex++] = s < 0 ? s * 32768 : s * 32767;

        s = ch1[i];
        // Clamp & Scale Right
        if (s > 1.0) s = 1.0; else if (s < -1.0) s = -1.0;
        sampleData[outputIndex++] = s < 0 ? s * 32768 : s * 32767;
      }
    } else if (numOfChan === 1) {
      const ch0 = channels[0];
      for (let i = 0; i < len; i++) {
        let s = ch0[i];
        // Clamp & Scale
        if (s > 1.0) s = 1.0; else if (s < -1.0) s = -1.0;
        sampleData[outputIndex++] = s < 0 ? s * 32768 : s * 32767;
      }
    } else {
      // General case for N channels
      for (let i = 0; i < len; i++) {
        for (let ch = 0; ch < numOfChan; ch++) {
          let s = channels[ch][i];

          // Clamp
          if (s > 1.0) s = 1.0;
          else if (s < -1.0) s = -1.0;

          // Scale to 16-bit integer
          s = s < 0 ? s * 32768 : s * 32767;

          sampleData[outputIndex++] = s;
        }
      }
    }
  } else {
    // Fallback for Big Endian systems
    let sampleIndex = 0;
    while (sampleIndex < len) {
      for (let i = 0; i < numOfChan; i++) {
        let s = channels[i][sampleIndex];
        // Clamp
        if (s > 1.0) s = 1.0;
        else if (s < -1.0) s = -1.0;

        s = (s < 0 ? s * 32768 : s * 32767) | 0;
        view.setInt16(44 + offset, s, true);
        offset += 2;
      }
      sampleIndex++;
    }
  }

  return new Blob([out], { type: 'audio/wav' });

  function setUint16(data: number) {
    view.setUint16(pos, data, true);
    pos += 2;
  }

  function setUint32(data: number) {
    view.setUint32(pos, data, true);
    pos += 4;
  }
}

export function blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}
