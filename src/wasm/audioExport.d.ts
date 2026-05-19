/** Exported memory */
export declare const memory: WebAssembly.Memory;
// Exported runtime interface
export declare function __new(size: number, id: number): number;
export declare function __pin(ptr: number): number;
export declare function __unpin(ptr: number): void;
export declare function __collect(): void;
export declare const __rtti_base: number;
/**
 * assembly/audioExport/floatToInt16
 * @param inputPtr `usize`
 * @param outputPtr `usize`
 * @param length `i32`
 */
export declare function floatToInt16(inputPtr: number, outputPtr: number, length: number): void;
/**
 * assembly/audioExport/interleaveChannels
 * @param channelPtrsPtr `usize`
 * @param numChannels `i32`
 * @param outputPtr `usize`
 * @param frameCount `i32`
 */
export declare function interleaveChannels(channelPtrsPtr: number, numChannels: number, outputPtr: number, frameCount: number): void;
