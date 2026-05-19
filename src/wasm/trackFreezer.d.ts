/** Exported memory */
export declare const memory: WebAssembly.Memory;
// Exported runtime interface
export declare function __new(size: number, id: number): number;
export declare function __pin(ptr: number): number;
export declare function __unpin(ptr: number): void;
export declare function __collect(): void;
export declare const __rtti_base: number;
/**
 * assembly/trackFreezer/findLoopPoints
 * @param bufferPtr `usize`
 * @param length `i32`
 * @param minLoopLength `i32`
 * @returns `u64`
 */
export declare function findLoopPoints(bufferPtr: number, length: number, minLoopLength: number): bigint;
/**
 * assembly/trackFreezer/mixToMono
 * @param leftPtr `usize`
 * @param rightPtr `usize`
 * @param outputPtr `usize`
 * @param length `i32`
 */
export declare function mixToMono(leftPtr: number, rightPtr: number, outputPtr: number, length: number): void;
