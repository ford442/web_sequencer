/** Exported memory */
export declare const memory: WebAssembly.Memory;
// Exported runtime interface
export declare function __new(size: number, id: number): number;
export declare function __pin(ptr: number): number;
export declare function __unpin(ptr: number): void;
export declare function __collect(): void;
export declare const __rtti_base: number;
/**
 * assembly/fft/fftForward
 * @param realPtr `usize`
 * @param imagPtr `usize`
 * @param size `i32`
 * @param bitReversePtr `usize`
 * @param twiddleRealPtr `usize`
 * @param twiddleImagPtr `usize`
 */
export declare function fftForward(realPtr: number, imagPtr: number, size: number, bitReversePtr: number, twiddleRealPtr: number, twiddleImagPtr: number): void;
/**
 * assembly/fft/computeMagnitude
 * @param realPtr `usize`
 * @param imagPtr `usize`
 * @param outputPtr `usize`
 * @param size `i32`
 */
export declare function computeMagnitude(realPtr: number, imagPtr: number, outputPtr: number, size: number): void;
/**
 * assembly/fft/computePhase
 * @param realPtr `usize`
 * @param imagPtr `usize`
 * @param outputPtr `usize`
 * @param size `i32`
 */
export declare function computePhase(realPtr: number, imagPtr: number, outputPtr: number, size: number): void;
/**
 * assembly/fft/applyHannWindow
 * @param inputPtr `usize`
 * @param outputPtr `usize`
 * @param size `i32`
 */
export declare function applyHannWindow(inputPtr: number, outputPtr: number, size: number): void;
/**
 * assembly/fft/generateTwiddleFactors
 * @param realPtr `usize`
 * @param imagPtr `usize`
 * @param size `i32`
 */
export declare function generateTwiddleFactors(realPtr: number, imagPtr: number, size: number): void;
/**
 * assembly/fft/generateBitReverseIndices
 * @param outputPtr `usize`
 * @param size `i32`
 */
export declare function generateBitReverseIndices(outputPtr: number, size: number): void;
