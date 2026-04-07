// @mode: assemblyscript
// @note-for-ai: AssemblyScript implementation of audio export DSP.
// It is compiled to WASM via: npm run build:wasm
// Output: public/audioExport.wasm
// Bridge file: src/utils/audioExport.ts
//
// Design constraints for WASM modules:
// - Only use primitive types (f32, i32) and TypedArrays
// - No JS object dependencies
// - Direct memory access via store<type>(offset, value)

/**
 * Converts Float32Array to Int16Array with hard clipping.
 * Clamps samples to [-1.0, 1.0] and scales to [-32768, 32767].
 *
 * @param inputPtr Pointer to input Float32Array
 * @param outputPtr Pointer to output Int16Array buffer
 * @param length Number of samples to process
 */
export function floatToInt16(inputPtr: usize, outputPtr: usize, length: i32): void {
    // Process 4 samples at a time using SIMD when possible
    const simdEnd = length & ~3; // Round down to nearest multiple of 4
    
    for (let i: i32 = 0; i < simdEnd; i += 4) {
        // Load 4 floats
        const v0 = load<f32>(inputPtr + <usize>((i + 0) * 4));
        const v1 = load<f32>(inputPtr + <usize>((i + 1) * 4));
        const v2 = load<f32>(inputPtr + <usize>((i + 2) * 4));
        const v3 = load<f32>(inputPtr + <usize>((i + 3) * 4));
        
        // Clamp each value to [-1.0, 1.0]
        const c0 = clamp<f32>(v0, -1.0, 1.0);
        const c1 = clamp<f32>(v1, -1.0, 1.0);
        const c2 = clamp<f32>(v2, -1.0, 1.0);
        const c3 = clamp<f32>(v3, -1.0, 1.0);
        
        // Convert to int16 (negative uses 32768, positive uses 32767)
        const s0 = i16(c0 < 0.0 ? c0 * 32768.0 : c0 * 32767.0);
        const s1 = i16(c1 < 0.0 ? c1 * 32768.0 : c1 * 32767.0);
        const s2 = i16(c2 < 0.0 ? c2 * 32768.0 : c2 * 32767.0);
        const s3 = i16(c3 < 0.0 ? c3 * 32768.0 : c3 * 32767.0);
        
        // Store as 16-bit integers
        store<i16>(outputPtr + <usize>((i + 0) * 2), s0);
        store<i16>(outputPtr + <usize>((i + 1) * 2), s1);
        store<i16>(outputPtr + <usize>((i + 2) * 2), s2);
        store<i16>(outputPtr + <usize>((i + 3) * 2), s3);
    }
    
    // Handle remaining samples
    for (let i: i32 = simdEnd; i < length; i++) {
        let s = load<f32>(inputPtr + <usize>(i * 4));
        s = clamp<f32>(s, -1.0, 1.0);
        const out = i16(s < 0.0 ? s * 32768.0 : s * 32767.0);
        store<i16>(outputPtr + <usize>(i * 2), out);
    }
}

/**
 * Interleaves multiple Float32 channels into a single Int16 output buffer.
 * Optimized for mono (1ch) and stereo (2ch) cases with unrolled loops.
 *
 * @param channelPtrsPtr Pointer to array of channel data pointers
 * @param numChannels Number of channels to interleave
 * @param outputPtr Pointer to output Int16Array buffer
 * @param frameCount Number of frames (samples per channel)
 */
export function interleaveChannels(
    channelPtrsPtr: usize,
    numChannels: i32,
    outputPtr: usize,
    frameCount: i32
): void {
    if (numChannels == 1) {
        // Mono: just convert, no interleaving needed
        const chPtr = load<usize>(channelPtrsPtr);
        floatToInt16(chPtr, outputPtr, frameCount);
    } else if (numChannels == 2) {
        // Stereo: optimized unrolled loop
        interleaveStereo(channelPtrsPtr, outputPtr, frameCount);
    } else {
        // General N-channel case
        interleaveNChannels(channelPtrsPtr, numChannels, outputPtr, frameCount);
    }
}

/**
 * Interleaves two channels (stereo) with loop unrolling.
 * 
 * @param channelPtrsPtr Pointer to array of 2 channel data pointers
 * @param outputPtr Pointer to output Int16Array buffer
 * @param frameCount Number of frames
 */
@inline
function interleaveStereo(channelPtrsPtr: usize, outputPtr: usize, frameCount: i32): void {
    const leftPtr = load<usize>(channelPtrsPtr);
    const rightPtr = load<usize>(channelPtrsPtr + 8); // 8 bytes = sizeof(usize) on 64-bit
    
    // Process 4 frames (8 samples) at a time
    const simdEnd = frameCount & ~3;
    let outIdx: i32 = 0;
    
    for (let i: i32 = 0; i < simdEnd; i += 4) {
        // Load left channel samples
        const l0 = load<f32>(leftPtr + <usize>((i + 0) * 4));
        const l1 = load<f32>(leftPtr + <usize>((i + 1) * 4));
        const l2 = load<f32>(leftPtr + <usize>((i + 2) * 4));
        const l3 = load<f32>(leftPtr + <usize>((i + 3) * 4));
        
        // Load right channel samples
        const r0 = load<f32>(rightPtr + <usize>((i + 0) * 4));
        const r1 = load<f32>(rightPtr + <usize>((i + 1) * 4));
        const r2 = load<f32>(rightPtr + <usize>((i + 2) * 4));
        const r3 = load<f32>(rightPtr + <usize>((i + 3) * 4));
        
        // Clamp and convert left
        const cl0 = i16(clampAndConvert(l0));
        const cl1 = i16(clampAndConvert(l1));
        const cl2 = i16(clampAndConvert(l2));
        const cl3 = i16(clampAndConvert(l3));
        
        // Clamp and convert right
        const cr0 = i16(clampAndConvert(r0));
        const cr1 = i16(clampAndConvert(r1));
        const cr2 = i16(clampAndConvert(r2));
        const cr3 = i16(clampAndConvert(r3));
        
        // Store interleaved: L0, R0, L1, R1, L2, R2, L3, R3
        store<i16>(outputPtr + <usize>((outIdx + 0) * 2), cl0);
        store<i16>(outputPtr + <usize>((outIdx + 1) * 2), cr0);
        store<i16>(outputPtr + <usize>((outIdx + 2) * 2), cl1);
        store<i16>(outputPtr + <usize>((outIdx + 3) * 2), cr1);
        store<i16>(outputPtr + <usize>((outIdx + 4) * 2), cl2);
        store<i16>(outputPtr + <usize>((outIdx + 5) * 2), cr2);
        store<i16>(outputPtr + <usize>((outIdx + 6) * 2), cl3);
        store<i16>(outputPtr + <usize>((outIdx + 7) * 2), cr3);
        
        outIdx += 8;
    }
    
    // Handle remaining frames
    for (let i: i32 = simdEnd; i < frameCount; i++) {
        const l = load<f32>(leftPtr + <usize>(i * 4));
        const r = load<f32>(rightPtr + <usize>(i * 4));
        
        store<i16>(outputPtr + <usize>((outIdx + 0) * 2), i16(clampAndConvert(l)));
        store<i16>(outputPtr + <usize>((outIdx + 1) * 2), i16(clampAndConvert(r)));
        
        outIdx += 2;
    }
}

/**
 * Interleaves N channels (general case).
 * 
 * @param channelPtrsPtr Pointer to array of channel data pointers
 * @param numChannels Number of channels
 * @param outputPtr Pointer to output buffer
 * @param frameCount Number of frames
 */
@inline
function interleaveNChannels(
    channelPtrsPtr: usize,
    numChannels: i32,
    outputPtr: usize,
    frameCount: i32
): void {
    let outIdx: i32 = 0;
    
    for (let frame: i32 = 0; frame < frameCount; frame++) {
        for (let ch: i32 = 0; ch < numChannels; ch++) {
            const chPtr = load<usize>(channelPtrsPtr + <usize>(ch * 8)); // 8 bytes per pointer
            const s = load<f32>(chPtr + <usize>(frame * 4));
            const converted = i16(clampAndConvert(s));
            store<i16>(outputPtr + <usize>(outIdx * 2), converted);
            outIdx++;
        }
    }
}

/**
 * Clamps a float sample to [-1.0, 1.0] and converts to int16 range.
 * Returns the int16 value as a number.
 * 
 * @param sample Input float sample
 * @returns Converted int16 value as f32 (for casting)
 */
@inline
function clampAndConvert(sample: f32): f32 {
    const clamped = clamp<f32>(sample, -1.0, 1.0);
    return clamped < 0.0 ? clamped * 32768.0 : clamped * 32767.0;
}

/**
 * Clamps a value between min and max.
 * 
 * @param value Value to clamp
 * @param min Minimum value
 * @param max Maximum value
 * @returns Clamped value
 */
@inline
function clamp<T>(value: T, min: T, max: T): T {
    return value < min ? min : (value > max ? max : value);
}
