/**
 * Audio DSP Bridge - OpenMP Parallelized Audio Processing
 * 
 * Provides JavaScript/TypeScript bindings to the OpenMP-parallelized
 * C++ audio processing functions in the Emscripten WASM module.
 */

// Type definitions for the WASM module
interface AudioDSPModule {
    applyGain(bufferPtr: number, numFrames: number, numChannels: number, gain: number): void;
    mixBuffers(
        outputPtr: number,
        inputPtrsPtr: number,
        gainsPtr: number,
        numBuffers: number,
        numFrames: number,
        numChannels: number
    ): void;
    findPeak(bufferPtr: number, numFrames: number, numChannels: number): number;
    deinterleaveStereo(
        interleavedPtr: number,
        leftPtr: number,
        rightPtr: number,
        numFrames: number
    ): void;
    interleaveStereo(
        leftPtr: number,
        rightPtr: number,
        interleavedPtr: number,
        numFrames: number
    ): void;
    floatToInt16(floatPtr: number, int16Ptr: number, numSamples: number): void;
    applyStereoWidth(
        leftPtr: number,
        rightPtr: number,
        numFrames: number,
        width: number
    ): void;
    getNumThreads(): number;
    setNumThreads(numThreads: number): void;

    // ── Open303 multi-instance API (added via open303_wrapper.cpp) ──────────
    open303_create(): number;
    open303_destroy(handle: number): void;
    open303_init(handle: number, sampleRate: number, bufferSize: number): number;
    open303_note_on(handle: number, midiNote: number, velocity: number): void;
    open303_note_off(handle: number, midiNote: number): void;
    open303_all_notes_off(handle: number): void;
    /** paramId: see Open303Param enum in open303_wrapper.cpp / Open303Params.ts */
    open303_set_param(handle: number, paramId: number, value: number): void;
    /** Write numFrames samples into outputPtr (caller-allocated WASM buffer). */
    open303_process(handle: number, outputPtr: number, numFrames: number): void;
}

// Global WASM module reference
declare global {
    interface Window {
        AudioDSP?: AudioDSPModule;
        Module?: {
            HEAPF32: Float32Array;
            HEAP16: Int16Array;
            _malloc(size: number): number;
            _free(ptr: number): void;
            // Open303 multi-instance API (exposed when hyphon_native includes open303_wrapper.cpp)
            open303_create?(): number;
            open303_destroy?(handle: number): void;
            open303_init?(handle: number, sampleRate: number, bufferSize: number): number;
            open303_note_on?(handle: number, midiNote: number, velocity: number): void;
            open303_note_off?(handle: number, midiNote: number): void;
            open303_all_notes_off?(handle: number): void;
            open303_set_param?(handle: number, paramId: number, value: number): void;
            open303_process?(handle: number, outputPtr: number, numFrames: number): void;
        };
    }
}

class AudioDSPError extends Error {
    constructor(message: string) {
        super(`[AudioDSP] ${message}`);
        this.name = 'AudioDSPError';
    }
}

/**
 * AudioDSP - High-performance audio processing with OpenMP threading
 */
export class AudioDSP {
    private module: AudioDSPModule | null = null;
    private heapF32: Float32Array | null = null;
    private heap16: Int16Array | null = null;

    constructor() {
        // Check if WASM module is loaded
        if (typeof window !== 'undefined' && window.AudioDSP) {
            this.module = window.AudioDSP;
        }
        if (typeof window !== 'undefined' && window.Module) {
            this.heapF32 = window.Module.HEAPF32;
            this.heap16 = window.Module.HEAP16;
        }
    }

    /**
     * Check if the DSP module is available
     */
    isAvailable(): boolean {
        return this.module !== null && this.heapF32 !== null;
    }

    /**
     * Get the number of OpenMP threads available
     */
    getNumThreads(): number {
        if (!this.module) return 1;
        return this.module.getNumThreads();
    }

    /**
     * Set the number of OpenMP threads to use
     */
    setNumThreads(numThreads: number): void {
        if (!this.module) return;
        this.module.setNumThreads(Math.max(1, numThreads));
    }

    /**
     * Apply gain to audio buffer in-place
     * Uses OpenMP parallelization for large buffers
     */
    applyGain(buffer: Float32Array, numChannels: number, gain: number): void {
        if (!this.isAvailable()) {
            // Fallback: manual implementation
            for (let i = 0; i < buffer.length; i++) {
                buffer[i] *= gain;
            }
            return;
        }

        const numFrames = buffer.length / numChannels;
        const ptr = this.copyToHeap(buffer);
        
        try {
            this.module!.applyGain(ptr, numFrames, numChannels, gain);
            this.copyFromHeap(ptr, buffer);
        } finally {
            this.free(ptr);
        }
    }

    /**
     * Find peak amplitude in buffer
     * Uses OpenMP parallel reduction for large buffers
     */
    findPeak(buffer: Float32Array, numChannels: number): number {
        if (!this.isAvailable()) {
            // Fallback: manual implementation
            let peak = 0;
            for (let i = 0; i < buffer.length; i++) {
                const abs = Math.abs(buffer[i]);
                if (abs > peak) peak = abs;
            }
            return peak;
        }

        const numFrames = buffer.length / numChannels;
        const ptr = this.copyToHeap(buffer);
        
        try {
            return this.module!.findPeak(ptr, numFrames, numChannels);
        } finally {
            this.free(ptr);
        }
    }

    /**
     * Convert Float32 audio to Int16
     * Uses OpenMP parallelization
     */
    floatToInt16(floatBuffer: Float32Array): Int16Array {
        if (!this.isAvailable()) {
            // Fallback: manual implementation
            const output = new Int16Array(floatBuffer.length);
            for (let i = 0; i < floatBuffer.length; i++) {
                let sample = floatBuffer[i] * 32767;
                if (sample > 32767) sample = 32767;
                if (sample < -32768) sample = -32768;
                output[i] = Math.round(sample);
            }
            return output;
        }

        const floatPtr = this.copyToHeap(floatBuffer);
        const int16Ptr = window.Module!._malloc(floatBuffer.length * 2);
        
        try {
            this.module!.floatToInt16(floatPtr, int16Ptr, floatBuffer.length);
            
            // Copy result
            const result = new Int16Array(floatBuffer.length);
            const heapView = new Int16Array(window.Module!.HEAP16.buffer, int16Ptr, floatBuffer.length);
            result.set(heapView);
            return result;
        } finally {
            this.free(floatPtr);
            this.free(int16Ptr);
        }
    }

    /**
     * Deinterleave stereo buffer
     * Uses OpenMP parallelization
     */
    deinterleaveStereo(interleaved: Float32Array): { left: Float32Array; right: Float32Array } {
        const numFrames = interleaved.length / 2;
        const left = new Float32Array(numFrames);
        const right = new Float32Array(numFrames);

        if (!this.isAvailable()) {
            // Fallback: manual implementation
            for (let i = 0; i < numFrames; i++) {
                left[i] = interleaved[i * 2];
                right[i] = interleaved[i * 2 + 1];
            }
            return { left, right };
        }

        const interleavedPtr = this.copyToHeap(interleaved);
        const leftPtr = window.Module!._malloc(numFrames * 4);
        const rightPtr = window.Module!._malloc(numFrames * 4);
        
        try {
            this.module!.deinterleaveStereo(interleavedPtr, leftPtr, rightPtr, numFrames);
            
            // Copy results
            const leftView = new Float32Array(window.Module!.HEAPF32.buffer, leftPtr, numFrames);
            const rightView = new Float32Array(window.Module!.HEAPF32.buffer, rightPtr, numFrames);
            left.set(leftView);
            right.set(rightView);
            
            return { left, right };
        } finally {
            this.free(interleavedPtr);
            this.free(leftPtr);
            this.free(rightPtr);
        }
    }

    /**
     * Interleave stereo channels
     * Uses OpenMP parallelization
     */
    interleaveStereo(left: Float32Array, right: Float32Array): Float32Array {
        const numFrames = left.length;
        const interleaved = new Float32Array(numFrames * 2);

        if (!this.isAvailable()) {
            // Fallback: manual implementation
            for (let i = 0; i < numFrames; i++) {
                interleaved[i * 2] = left[i];
                interleaved[i * 2 + 1] = right[i];
            }
            return interleaved;
        }

        const leftPtr = this.copyToHeap(left);
        const rightPtr = this.copyToHeap(right);
        const interleavedPtr = window.Module!._malloc(numFrames * 8);
        
        try {
            this.module!.interleaveStereo(leftPtr, rightPtr, interleavedPtr, numFrames);
            
            // Copy result
            const view = new Float32Array(window.Module!.HEAPF32.buffer, interleavedPtr, numFrames * 2);
            interleaved.set(view);
            return interleaved;
        } finally {
            this.free(leftPtr);
            this.free(rightPtr);
            this.free(interleavedPtr);
        }
    }

    /**
     * Apply stereo width adjustment
     * width: 0.0 = mono, 1.0 = full stereo, 2.0 = extra wide
     */
    applyStereoWidth(left: Float32Array, right: Float32Array, width: number): void {
        if (left.length !== right.length) {
            throw new AudioDSPError('Left and right channels must have same length');
        }

        if (!this.isAvailable()) {
            // Fallback: manual implementation
            const midScale = 1.0 - (width - 1.0) * 0.5;
            const sideScale = width * 0.5;
            
            for (let i = 0; i < left.length; i++) {
                const mid = (left[i] + right[i]) * 0.5;
                const side = (left[i] - right[i]) * 0.5;
                
                left[i] = mid * midScale + side * sideScale;
                right[i] = mid * midScale - side * sideScale;
            }
            return;
        }

        const leftPtr = this.copyToHeap(left);
        const rightPtr = this.copyToHeap(right);
        
        try {
            this.module!.applyStereoWidth(leftPtr, rightPtr, left.length, width);
            
            // Copy results back
            const leftView = new Float32Array(window.Module!.HEAPF32.buffer, leftPtr, left.length);
            const rightView = new Float32Array(window.Module!.HEAPF32.buffer, rightPtr, right.length);
            left.set(leftView);
            right.set(rightView);
        } finally {
            this.free(leftPtr);
            this.free(rightPtr);
        }
    }

    /**
     * Mix multiple buffers with individual gains
     * All buffers must have the same length
     */
    mixBuffers(buffers: Float32Array[], gains: number[]): Float32Array {
        if (buffers.length === 0) {
            throw new AudioDSPError('At least one buffer required');
        }
        if (buffers.length !== gains.length) {
            throw new AudioDSPError('Number of buffers must match number of gains');
        }

        const numSamples = buffers[0].length;
        const numChannels = 2; // Assume stereo
        const numFrames = numSamples / numChannels;

        // Validate all buffers have same length
        for (let i = 1; i < buffers.length; i++) {
            if (buffers[i].length !== numSamples) {
                throw new AudioDSPError('All buffers must have the same length');
            }
        }

        const output = new Float32Array(numSamples);

        if (!this.isAvailable()) {
            // Fallback: manual implementation
            for (let b = 0; b < buffers.length; b++) {
                for (let i = 0; i < numSamples; i++) {
                    output[i] += buffers[b][i] * gains[b];
                }
            }
            return output;
        }

        // Copy input buffers to heap
        const inputPtrs: number[] = [];
        for (const buffer of buffers) {
            inputPtrs.push(this.copyToHeap(buffer));
        }
        
        const inputPtrsArray = new Uint32Array(inputPtrs);
        const inputPtrsPtr = this.copyToHeap(new Uint8Array(inputPtrsArray.buffer));
        
        const gainsArray = new Float32Array(gains);
        const gainsPtr = this.copyToHeap(new Uint8Array(gainsArray.buffer));
        
        const outputPtr = window.Module!._malloc(numSamples * 4);
        
        try {
            this.module!.mixBuffers(
                outputPtr,
                inputPtrsPtr,
                gainsPtr,
                buffers.length,
                numFrames,
                numChannels
            );
            
            // Copy result
            const view = new Float32Array(window.Module!.HEAPF32.buffer, outputPtr, numSamples);
            output.set(view);
            return output;
        } finally {
            for (const ptr of inputPtrs) {
                this.free(ptr);
            }
            this.free(inputPtrsPtr);
            this.free(gainsPtr);
            this.free(outputPtr);
        }
    }

    // Helper: Copy Float32Array to WASM heap
    private copyToHeap(array: ArrayBufferView): number {
        const numBytes = array.byteLength;
        const ptr = window.Module!._malloc(numBytes);
        const heapBytes = new Uint8Array(window.Module!.HEAPF32.buffer, ptr, numBytes);
        heapBytes.set(new Uint8Array(array.buffer, array.byteOffset, numBytes));
        return ptr;
    }

    // Helper: Copy from WASM heap to Float32Array
    private copyFromHeap(ptr: number, array: Float32Array): void {
        const heapFloats = new Float32Array(window.Module!.HEAPF32.buffer, ptr, array.length);
        array.set(heapFloats);
    }

    // Helper: Free WASM memory
    private free(ptr: number): void {
        window.Module!._free(ptr);
    }
}

// Export singleton instance
export const audioDSP = new AudioDSP();

// ─────────────────────────────────────────────────────────────────────────────
// Open303 native instance API (uses hyphon_native.wasm / window.Module)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parameter IDs for Open303Native.setParam() – must match open303_wrapper.cpp.
 */
export const Open303ParamId = {
    WAVEFORM:       0,
    TUNING:         1,
    CUTOFF:         2,
    RESONANCE:      3,
    ENV_MOD:        4,
    DECAY:          5,
    ACCENT:         6,
    VOLUME:         7,
    FILTER_MODE:    8,
    NORMAL_DECAY:   9,
    ACCENT_DECAY:   10,
    SLIDE_TIME:     11,
    SOFT_ATTACK:    12,
    SQUARE_DRIVER:  13,
} as const;

/**
 * Returns true when hyphon_native.wasm exposes the Open303 instance API.
 * This is the case after a build that includes open303_wrapper.cpp.
 */
export function hasOpen303Native(): boolean {
    return typeof window !== 'undefined'
        && typeof window.Module?.open303_create === 'function';
}

/**
 * Thin TypeScript wrapper around a single Open303 instance living inside
 * hyphon_native.wasm.  Multiple instances can coexist (e.g. Lead + Bass).
 *
 * Usage:
 *   const inst = new Open303Native(audioContext.sampleRate);
 *   inst.noteOn(60, 100);
 *   // (render audio via open303_process in a worklet or ScriptProcessor)
 *   inst.dispose();
 */
export class Open303Native {
    private handle: number = 0;
    private mod: NonNullable<Window['Module']> | null = null;
    public readonly isAvailable: boolean;

    constructor(sampleRate: number, bufferSize = 128) {
        if (typeof window !== 'undefined' && window.Module?.open303_create) {
            this.mod = window.Module;
            this.handle = this.mod.open303_create!();
            this.mod.open303_init!(this.handle, sampleRate, bufferSize);
            this.isAvailable = true;
        } else {
            this.isAvailable = false;
        }
    }

    noteOn(midiNote: number, velocity: number): void {
        if (this.mod && this.handle) this.mod.open303_note_on!(this.handle, midiNote, velocity);
    }

    noteOff(midiNote: number): void {
        if (this.mod && this.handle) this.mod.open303_note_off!(this.handle, midiNote);
    }

    allNotesOff(): void {
        if (this.mod && this.handle) this.mod.open303_all_notes_off!(this.handle);
    }

    setParam(paramId: number, value: number): void {
        if (this.mod && this.handle) this.mod.open303_set_param!(this.handle, paramId, value);
    }

    /**
     * Render @p numFrames samples into a caller-allocated WASM heap buffer.
     * @param outputPtr WASM heap pointer (obtained via window.Module._malloc)
     * @param numFrames number of mono samples to generate
     */
    process(outputPtr: number, numFrames: number): void {
        if (this.mod && this.handle) this.mod.open303_process!(this.handle, outputPtr, numFrames);
    }

    /** Release the underlying C++ instance. */
    dispose(): void {
        if (this.mod && this.handle) {
            this.mod.open303_destroy!(this.handle);
            this.handle = 0;
        }
    }
}
