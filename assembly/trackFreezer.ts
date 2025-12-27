// @mode: assemblyscript

/**
 * Finds loop points in a mono audio buffer using zero-crossing detection.
 *
 * @param bufferPtr Pointer to the float32 audio data
 * @param length Length of the buffer
 * @param minLoopLength Minimum required loop length in samples
 * @returns A packed 64-bit integer where high 32 bits are start index and low 32 bits are end index
 */
export function findLoopPoints(bufferPtr: usize, length: i32, minLoopLength: i32): u64 {
    // 10ms at 44.1kHz is ~441 samples
    // Math.min(441, length - minLoopLength)
    let searchLimit = 441;
    if (length - minLoopLength < searchLimit) {
        searchLimit = length - minLoopLength;
    }

    let loopStart: i32 = searchLimit;

    // Find zero crossing near start (positive slope: - to +)
    // buffer[i] >= 0 && buffer[i-1] < 0
    for (let i: i32 = searchLimit; i < length / 2; i++) {
        let curr = load<f32>(bufferPtr + <usize>(i * 4));
        let prev = load<f32>(bufferPtr + <usize>((i - 1) * 4));

        if (curr >= 0.0 && prev < 0.0) {
            loopStart = i;
            break;
        }
    }

    let loopEnd: i32 = length - 1;

    // Find zero crossing near end
    // Must be > loopStart + minLoopLength
    for (let i: i32 = length - 1; i > loopStart + minLoopLength; i--) {
        let curr = load<f32>(bufferPtr + <usize>(i * 4));
        let prev = load<f32>(bufferPtr + <usize>((i - 1) * 4));

        if (curr >= 0.0 && prev < 0.0) {
            loopEnd = i;
            break;
        }
    }

    // Pack results into u64
    // High 32 bits: Start
    // Low 32 bits: End
    return (u64(loopStart) << 32) | u64(loopEnd);
}

/**
 * Mixes two audio channels into a single mono buffer.
 *
 * @param leftPtr Pointer to left channel float32 data
 * @param rightPtr Pointer to right channel float32 data
 * @param outputPtr Pointer to output buffer float32 data
 * @param length Length of the buffers in samples
 */
export function mixToMono(leftPtr: usize, rightPtr: usize, outputPtr: usize, length: i32): void {
    // Determine number of channels based on pointers
    // If rightPtr is 0, just copy left? No, usage implies mixing.
    // Assuming standard stereo mix (L+R)/2

    // Check if we can use SIMD later (v128), for now simple loop
    for (let i: i32 = 0; i < length; i++) {
        let l = load<f32>(leftPtr + <usize>(i * 4));
        let r = load<f32>(rightPtr + <usize>(i * 4));

        let mixed = (l + r) * 0.5;
        store<f32>(outputPtr + <usize>(i * 4), mixed);
    }
}
