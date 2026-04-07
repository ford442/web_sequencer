// assembly/fft.ts
// @mode: assemblyscript
// FFT operations for spectral analysis - Cooley-Tukey radix-2 implementation
// Compiled to WASM via: npm run build:wasm:fft
// Output: src/wasm/fft.wasm
// Bridge file: src/utils/fft.ts
//
// Design constraints:
// - Only use primitive types (f32, i32, usize) and direct memory access
// - No JS object dependencies
// - Arrays passed as pointers to WASM memory

@inline const PI: f32 = 3.14159265359;

/**
 * Perform in-place forward FFT using Cooley-Tukey algorithm
 * 
 * @param realPtr Pointer to real part array (f32, modified in-place)
 * @param imagPtr Pointer to imaginary part array (f32, modified in-place)
 * @param size FFT size (must be power of 2)
 * @param bitReversePtr Pointer to bit-reversed indices (u32 array)
 * @param twiddleRealPtr Pointer to twiddle factors real part (f32 array)
 * @param twiddleImagPtr Pointer to twiddle factors imaginary part (f32 array)
 */
export function fftForward(
  realPtr: usize,
  imagPtr: usize,
  size: i32,
  bitReversePtr: usize,
  twiddleRealPtr: usize,
  twiddleImagPtr: usize
): void {
  // Step 1: Bit-reversal permutation
  // We need to swap elements according to bit-reversed indices
  // To avoid double-swapping, we only swap when i < bitReversed[i]
  for (let i: i32 = 0; i < size; i++) {
    const revIdx: i32 = i32(load<u32>(bitReversePtr + <usize>(i * 4)));
    
    if (i < revIdx) {
      // Swap real parts
      const realI = load<f32>(realPtr + <usize>(i * 4));
      const realRev = load<f32>(realPtr + <usize>(revIdx * 4));
      store<f32>(realPtr + <usize>(i * 4), realRev);
      store<f32>(realPtr + <usize>(revIdx * 4), realI);
      
      // Swap imaginary parts (imag is all zeros initially)
      const imagI = load<f32>(imagPtr + <usize>(i * 4));
      const imagRev = load<f32>(imagPtr + <usize>(revIdx * 4));
      store<f32>(imagPtr + <usize>(i * 4), imagRev);
      store<f32>(imagPtr + <usize>(revIdx * 4), imagI);
    }
  }
  
  // Step 2: Cooley-Tukey butterfly operations
  // stage doubles each iteration: 1, 2, 4, 8, ... size/2
  for (let stage: i32 = 1; stage < size; stage <<= 1) {
    const step: i32 = stage << 1;           // Distance between butterfly pairs
    const twiddleStep: i32 = size / step;   // Step size in twiddle factor table
    
    // Process each group of butterflies
    for (let group: i32 = 0; group < stage; group++) {
      // Get twiddle factor for this group
      const twiddleIdx: i32 = group * twiddleStep;
      const wr: f32 = load<f32>(twiddleRealPtr + <usize>(twiddleIdx * 4));
      const wi: f32 = load<f32>(twiddleImagPtr + <usize>(twiddleIdx * 4));
      
      // Process all butterflies in this group
      for (let pair: i32 = group; pair < size; pair += step) {
        const evenIdx: i32 = pair;
        const oddIdx: i32 = pair + stage;
        
        // Load even and odd elements
        const evenReal: f32 = load<f32>(realPtr + <usize>(evenIdx * 4));
        const evenImag: f32 = load<f32>(imagPtr + <usize>(evenIdx * 4));
        const oddReal: f32 = load<f32>(realPtr + <usize>(oddIdx * 4));
        const oddImag: f32 = load<f32>(imagPtr + <usize>(oddIdx * 4));
        
        // Butterfly: twiddle * odd
        // (wr + j*wi) * (oddReal + j*oddImag)
        // = (wr*oddReal - wi*oddImag) + j*(wr*oddImag + wi*oddReal)
        const twiddledOddReal: f32 = wr * oddReal - wi * oddImag;
        const twiddledOddImag: f32 = wr * oddImag + wi * oddReal;
        
        // even + twiddledOdd
        store<f32>(realPtr + <usize>(evenIdx * 4), evenReal + twiddledOddReal);
        store<f32>(imagPtr + <usize>(evenIdx * 4), evenImag + twiddledOddImag);
        
        // even - twiddledOdd
        store<f32>(realPtr + <usize>(oddIdx * 4), evenReal - twiddledOddReal);
        store<f32>(imagPtr + <usize>(oddIdx * 4), evenImag - twiddledOddImag);
      }
    }
  }
}

/**
 * Compute magnitude spectrum from complex FFT result
 * 
 * @param realPtr Pointer to real part array (f32)
 * @param imagPtr Pointer to imaginary part array (f32)
 * @param outputPtr Pointer to output magnitude array (f32)
 * @param size Number of elements to compute (typically size/2 + 1 for real FFT)
 */
export function computeMagnitude(
  realPtr: usize,
  imagPtr: usize,
  outputPtr: usize,
  size: i32
): void {
  for (let i: i32 = 0; i < size; i++) {
    const real: f32 = load<f32>(realPtr + <usize>(i * 4));
    const imag: f32 = load<f32>(imagPtr + <usize>(i * 4));
    
    // magnitude = sqrt(real^2 + imag^2)
    const magnitude: f32 = f32(Math.sqrt(f64(real * real + imag * imag)));
    store<f32>(outputPtr + <usize>(i * 4), magnitude);
  }
}

/**
 * Compute phase spectrum from complex FFT result
 * 
 * @param realPtr Pointer to real part array (f32)
 * @param imagPtr Pointer to imaginary part array (f32)
 * @param outputPtr Pointer to output phase array (f32)
 * @param size Number of elements to compute
 */
export function computePhase(
  realPtr: usize,
  imagPtr: usize,
  outputPtr: usize,
  size: i32
): void {
  for (let i: i32 = 0; i < size; i++) {
    const real: f32 = load<f32>(realPtr + <usize>(i * 4));
    const imag: f32 = load<f32>(imagPtr + <usize>(i * 4));
    
    // phase = atan2(imag, real)
    const phase: f32 = f32(Math.atan2(f64(imag), f64(real)));
    store<f32>(outputPtr + <usize>(i * 4), phase);
  }
}

/**
 * Apply Hann window to input signal
 * 
 * @param inputPtr Pointer to input array (f32)
 * @param outputPtr Pointer to output array (f32)
 * @param size Length of the arrays
 */
export function applyHannWindow(
  inputPtr: usize,
  outputPtr: usize,
  size: i32
): void {
  // Avoid division by zero when size is 1
  if (size <= 1) {
    if (size === 1) {
      const val: f32 = load<f32>(inputPtr);
      store<f32>(outputPtr, val);
    }
    return;
  }
  
  const nMinus1: f32 = f32(size - 1);
  const twoPi: f32 = 2.0 * PI;
  
  for (let i: i32 = 0; i < size; i++) {
    const inputVal: f32 = load<f32>(inputPtr + <usize>(i * 4));
    
    // Hann window: 0.5 * (1 - cos(2 * PI * i / (n - 1)))
    const angle: f32 = twoPi * f32(i) / nMinus1;
    const windowVal: f32 = 0.5 * (1.0 - f32(Math.cos(f64(angle))));
    
    store<f32>(outputPtr + <usize>(i * 4), inputVal * windowVal);
  }
}

/**
 * Generate twiddle factors for FFT
 * 
 * @param realPtr Pointer to output real part array (f32)
 * @param imagPtr Pointer to output imaginary part array (f32)
 * @param size FFT size (twiddle table size is size/2)
 */
export function generateTwiddleFactors(
  realPtr: usize,
  imagPtr: usize,
  size: i32
): void {
  const halfSize: i32 = size / 2;
  const sizeF: f32 = f32(size);
  const twoPi: f32 = 2.0 * PI;
  
  for (let k: i32 = 0; k < halfSize; k++) {
    // angle = -2 * PI * k / size (negative for forward FFT)
    const angle: f32 = -twoPi * f32(k) / sizeF;
    
    store<f32>(realPtr + <usize>(k * 4), f32(Math.cos(f64(angle))));
    store<f32>(imagPtr + <usize>(k * 4), f32(Math.sin(f64(angle))));
  }
}

/**
 * Generate bit-reversed indices
 * 
 * @param outputPtr Pointer to output array (u32)
 * @param size FFT size (must be power of 2)
 */
export function generateBitReverseIndices(
  outputPtr: usize,
  size: i32
): void {
  // Calculate number of bits needed
  let bits: i32 = 0;
  let temp: i32 = size;
  while (temp > 1) {
    temp >>= 1;
    bits++;
  }
  
  for (let i: i32 = 0; i < size; i++) {
    let reversed: i32 = 0;
    for (let j: i32 = 0; j < bits; j++) {
      reversed = (reversed << 1) | ((i >> j) & 1);
    }
    store<u32>(outputPtr + <usize>(i * 4), u32(reversed));
  }
}
