/** Exported memory */
export declare const memory: WebAssembly.Memory;
// Exported runtime interface
export declare function __new(size: number, id: number): number;
export declare function __pin(ptr: number): number;
export declare function __unpin(ptr: number): void;
export declare function __collect(): void;
export declare const __rtti_base: number;
/**
 * assembly/xmExport/findPeak
 * @param bufferPtr `usize`
 * @param length `i32`
 * @returns `f32`
 */
export declare function findPeak(bufferPtr: number, length: number): number;
/**
 * assembly/xmExport/findZeroCrossing
 * @param bufferPtr `usize`
 * @param position `i32`
 * @param direction `i32`
 * @param maxSearch `i32`
 * @returns `i32`
 */
export declare function findZeroCrossing(bufferPtr: number, position: number, direction: number, maxSearch: number): number;
/**
 * assembly/xmExport/normalizeAndConvert
 * @param bufferPtr `usize`
 * @param outputPtr `usize`
 * @param length `i32`
 * @param peak `f32`
 * @param targetPeak `f32`
 */
export declare function normalizeAndConvert(bufferPtr: number, outputPtr: number, length: number, peak: number, targetPeak: number): void;
/**
 * assembly/xmExport/convertToInt16
 * @param bufferPtr `usize`
 * @param outputPtr `usize`
 * @param length `i32`
 */
export declare function convertToInt16(bufferPtr: number, outputPtr: number, length: number): void;
