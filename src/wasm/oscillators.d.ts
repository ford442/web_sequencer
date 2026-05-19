/** Exported memory */
export declare const memory: WebAssembly.Memory;
// Exported runtime interface
export declare function __new(size: number, id: number): number;
export declare function __pin(ptr: number): number;
export declare function __unpin(ptr: number): void;
export declare function __collect(): void;
export declare const __rtti_base: number;
/**
 * assembly/oscillators/generate
 * @param offset `i32`
 * @param sampleRate `f32`
 * @param freq `f32`
 * @param duration `f32`
 * @param type `i32`
 * @param cutoff `f32`
 * @param resonance `f32`
 * @returns `i32`
 */
export declare function generate(offset: number, sampleRate: number, freq: number, duration: number, type: number, cutoff: number, resonance: number): number;
