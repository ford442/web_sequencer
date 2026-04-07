// @mode: assemblyscript
// XM Export DSP utilities - AssemblyScript implementation
// Bridge file: src/utils/xmExport.ts
// Output: src/wasm/xmExport.wasm
//
// Design constraints for WASM modules:
// - Only use primitive types (f32, i32) and TypedArrays
// - No JS object dependencies
// - Direct memory access via load<type>(offset) / store<type>(offset, value)

/**
 * Find the peak amplitude (maximum absolute value) in a float32 buffer.
 * Uses SIMD for parallel reduction when possible.
 *
 * @param bufferPtr Pointer to the float32 audio buffer
 * @param length Number of samples in the buffer
 * @returns The peak amplitude as f32
 */
export function findPeak(bufferPtr: usize, length: i32): f32 {
  if (length <= 0) return 0.0;

  let peak: f32 = 0.0;
  
  // Process 4 samples at a time using SIMD
  const simdLength = length & ~3; // Round down to nearest multiple of 4
  
  if (simdLength > 0) {
    // Initialize with first 4 samples
    let maxVec = v128.abs<f32>(v128.load(bufferPtr));
    
    for (let i: i32 = 4; i < simdLength; i += 4) {
      const vec = v128.abs<f32>(v128.load(bufferPtr + <usize>(i * 4)));
      maxVec = v128.max<f32>(maxVec, vec);
    }
    
    // Horizontal reduction: get max of all 4 lanes
    // Extract lanes and find max
    const lane0 = v128.extract_lane<f32>(maxVec, 0);
    const lane1 = v128.extract_lane<f32>(maxVec, 1);
    const lane2 = v128.extract_lane<f32>(maxVec, 2);
    const lane3 = v128.extract_lane<f32>(maxVec, 3);
    
    peak = max(max(lane0, lane1), max(lane2, lane3));
  }
  
  // Process remaining samples
  for (let i: i32 = simdLength; i < length; i++) {
    const sample: f32 = load<f32>(bufferPtr + <usize>(i * 4));
    const absSample: f32 = abs(sample);
    if (absSample > peak) {
      peak = absSample;
    }
  }
  
  return peak;
}

/**
 * Find a zero-crossing point near the given position.
 * Searches for where signal crosses zero with positive slope (buffer[i] >= 0 && buffer[i-1] < 0)
 *
 * @param bufferPtr Pointer to the float32 audio buffer
 * @param position Starting position to search from
 * @param direction 1 = forward, -1 = backward
 * @param maxSearch Maximum samples to search
 * @returns Position of zero crossing, or original position if not found
 */
export function findZeroCrossing(
  bufferPtr: usize, 
  position: i32, 
  direction: i32, 
  maxSearch: i32
): i32 {
  // Load buffer length from memory context (passed as additional parameter)
  // Since we don't store length at bufferPtr-4, we need length as parameter
  // But JS side knows length from Float32Array
  
  // For now, we rely on the caller to provide valid position
  // The buffer bounds check is done by the caller
  
  if (direction == 1) {
    // Forward search
    if (position < 1) position = 1;
    const limit: i32 = position + maxSearch;
    
    for (let idx: i32 = position; idx < limit; idx++) {
      const curr: f32 = load<f32>(bufferPtr + <usize>(idx * 4));
      const prev: f32 = load<f32>(bufferPtr + <usize>((idx - 1) * 4));
      
      if (curr >= 0.0 && prev < 0.0) {
        return idx;
      }
    }
  } else {
    // Backward search
    if (position < 1) return position;
    const limit: i32 = position - maxSearch + 1;
    
    for (let idx: i32 = position; idx >= limit; idx--) {
      if (idx < 1) break;
      const curr: f32 = load<f32>(bufferPtr + <usize>(idx * 4));
      const prev: f32 = load<f32>(bufferPtr + <usize>((idx - 1) * 4));
      
      if (curr >= 0.0 && prev < 0.0) {
        return idx;
      }
    }
  }
  
  return position;
}

/**
 * Single-pass normalization and Int16 conversion.
 * Applies gain, clamps to [-1, 1], and converts to int16.
 *
 * @param bufferPtr Pointer to input float32 buffer
 * @param outputPtr Pointer to output int16 buffer  
 * @param length Number of samples
 * @param peak The current peak amplitude of the input
 * @param targetPeak The desired peak amplitude after normalization
 */
export function normalizeAndConvert(
  bufferPtr: usize,
  outputPtr: usize,
  length: i32,
  peak: f32,
  targetPeak: f32
): void {
  if (length <= 0) return;
  
  // Calculate gain (1.0 if no normalization needed)
  let gain: f32 = 1.0;
  if (peak >= 0.001 && peak < 0.5) {
    gain = targetPeak / peak;
  }
  
  const scale: f32 = 32767.0;
  
  // Process samples
  for (let i: i32 = 0; i < length; i++) {
    let sample: f32 = load<f32>(bufferPtr + <usize>(i * 4));
    
    // Apply gain
    sample = sample * gain;
    
    // Fast hard clip to [-1, 1]
    if (sample > 1.0) sample = 1.0;
    else if (sample < -1.0) sample = -1.0;
    
    // Convert to int16 and store
    const intValue: i32 = i32(sample * scale);
    store<i16>(outputPtr + <usize>(i * 2), i16(intValue));
  }
}

/**
 * Simple float32 to int16 conversion without normalization.
 * Clamps to [-1, 1] and converts.
 *
 * @param bufferPtr Pointer to input float32 buffer
 * @param outputPtr Pointer to output int16 buffer
 * @param length Number of samples
 */
export function convertToInt16(
  bufferPtr: usize,
  outputPtr: usize,
  length: i32
): void {
  if (length <= 0) return;
  
  const scale: f32 = 32767.0;
  
  for (let i: i32 = 0; i < length; i++) {
    let sample: f32 = load<f32>(bufferPtr + <usize>(i * 4));
    
    // Hard clip
    if (sample > 1.0) sample = 1.0;
    else if (sample < -1.0) sample = -1.0;
    
    // Convert to int16
    const intValue: i32 = i32(sample * scale);
    store<i16>(outputPtr + <usize>(i * 2), i16(intValue));
  }
}
