/**
 * FFT Utility - Fast Fourier Transform implementation for spectral analysis
 * 
 * @mode: bridge
 * This is a bridge file that uses WASM for performance-critical operations
 * with a JavaScript fallback.
 * 
 * Used by ArtifactDetector for spectral flux calculation.
 * Implements Cooley-Tukey radix-2 FFT algorithm.
 */

import { loadFFTModule, isFFTModuleLoaded, type FFTWasmExports } from '@/utils/fftLoader';

export interface FFTConfig {
    size: number;
}

/**
 * Complex number representation
 */
export interface Complex {
    real: number;
    imag: number;
}

/**
 * FFT result containing magnitude and phase spectra
 */
export interface FFTResult {
    /** Magnitude spectrum */
    magnitude: Float32Array;
    /** Phase spectrum */
    phase: Float32Array;
    /** Frequency bins */
    frequencies: Float32Array;
}

/**
 * FFT utility class for spectral analysis
 */
export class FFT {
    private size: number;
    private bitReversedIndices: Uint32Array;
    private twiddleReal: Float32Array;
    private twiddleImag: Float32Array;
    private wasmModule: FFTWasmExports | null = null;
    private useWasm: boolean = false;

    // WASM memory buffers
    private wasmReal: Float32Array | null = null;
    private wasmImag: Float32Array | null = null;
    private wasmMagnitude: Float32Array | null = null;
    private wasmPhase: Float32Array | null = null;
    private realPtr: number | null = null;
    private imagPtr: number | null = null;
    private magnitudePtr: number | null = null;
    private phasePtr: number | null = null;

    /**
     * Create a new FFT instance
     * @param config FFT configuration
     */
    constructor(config: FFTConfig) {
        this.size = config.size;
        
        if (!this.isPowerOfTwo(this.size)) {
            throw new Error(`FFT size must be a power of 2, got ${this.size}`);
        }

        this.bitReversedIndices = this.computeBitReversedIndices();
        this.twiddleReal = new Float32Array(this.size / 2);
        this.twiddleImag = new Float32Array(this.size / 2);
        this.computeTwiddleFactors();

        // Try to initialize WASM module
        void this.initWasm();
    }

    /**
     * Initialize WASM module if available
     */
    private async initWasm(): Promise<void> {
        try {
            const instance = await loadFFTModule();
            this.wasmModule = instance.exports as unknown as FFTWasmExports;
            if (this.wasmModule && isFFTModuleLoaded()) {
                this.useWasm = true;
                this.allocateWasmBuffers();
            }
        } catch (e) {
            console.warn('WASM FFT module not available, using JS fallback:', e);
            this.useWasm = false;
        }
    }

    /**
     * Allocate buffers in WASM memory
     */
    private allocateWasmBuffers(): void {
        if (!this.wasmModule) return;

        const size = this.size;
        const halfSize = Math.floor(size / 2) + 1;

        // Allocate memory in WASM
        const realPtr = this.wasmModule.__pin(this.wasmModule.__new(size * 4));
        const imagPtr = this.wasmModule.__pin(this.wasmModule.__new(size * 4));
        const magnitudePtr = this.wasmModule.__pin(this.wasmModule.__new(halfSize * 4));
        const phasePtr = this.wasmModule.__pin(this.wasmModule.__new(halfSize * 4));

        // Create Float32Array views
        this.wasmReal = new Float32Array(this.wasmModule.memory.buffer, realPtr, size);
        this.wasmImag = new Float32Array(this.wasmModule.memory.buffer, imagPtr, size);
        this.wasmMagnitude = new Float32Array(this.wasmModule.memory.buffer, magnitudePtr, halfSize);
        this.wasmPhase = new Float32Array(this.wasmModule.memory.buffer, phasePtr, halfSize);

        // Store pointers
        this.realPtr = realPtr;
        this.imagPtr = imagPtr;
        this.magnitudePtr = magnitudePtr;
        this.phasePtr = phasePtr;
    }

    /**
     * Free WASM memory buffers
     */
    private freeWasmBuffers(): void {
        if (!this.wasmModule) return;

        if (this.realPtr !== null) this.wasmModule.__unpin(this.realPtr);
        if (this.imagPtr !== null) this.wasmModule.__unpin(this.imagPtr);
        if (this.magnitudePtr !== null) this.wasmModule.__unpin(this.magnitudePtr);
        if (this.phasePtr !== null) this.wasmModule.__unpin(this.phasePtr);

        this.realPtr = null;
        this.imagPtr = null;
        this.magnitudePtr = null;
        this.phasePtr = null;

        this.wasmReal = null;
        this.wasmImag = null;
        this.wasmMagnitude = null;
        this.wasmPhase = null;
    }

    /**
     * Check if a number is a power of 2
     */
    private isPowerOfTwo(n: number): boolean {
        return (n & (n - 1)) === 0 && n > 0;
    }

    /**
     * Compute bit-reversed indices for in-place FFT
     */
    private computeBitReversedIndices(): Uint32Array {
        const indices = new Uint32Array(this.size);
        const bits = Math.log2(this.size);
        
        for (let i = 0; i < this.size; i++) {
            let reversed = 0;
            for (let j = 0; j < bits; j++) {
                reversed = (reversed << 1) | ((i >> j) & 1);
            }
            indices[i] = reversed;
        }
        
        return indices;
    }

    /**
     * Compute twiddle factors (roots of unity)
     */
    private computeTwiddleFactors(): void {
        for (let k = 0; k < this.size / 2; k++) {
            const angle = -2 * Math.PI * k / this.size;
            this.twiddleReal[k] = Math.cos(angle);
            this.twiddleImag[k] = Math.sin(angle);
        }
    }

    /**
     * Perform forward FFT on real input using WASM or JS fallback
     * @param input Real-valued input signal
     * @returns FFT result with magnitude and phase
     */
    forward(input: Float32Array): FFTResult {
        if (this.useWasm && this.wasmModule && this.wasmReal && this.wasmImag) {
            return this.forwardWasm(input);
        }
        return this.forwardJs(input);
    }

    /**
     * WASM-accelerated forward FFT
     */
    private forwardWasm(input: Float32Array): FFTResult {
        if (input.length !== this.size) {
            throw new Error(`Input length ${input.length} does not match FFT size ${this.size}`);
        }

        if (!this.wasmModule || !this.wasmReal || !this.wasmImag || 
            !this.wasmMagnitude || !this.wasmPhase) {
            throw new Error('WASM buffers not initialized');
        }

        const halfSize = Math.floor(this.size / 2) + 1;

        // Copy input to WASM real buffer (bit-reversed order handled in WASM)
        for (let i = 0; i < this.size; i++) {
            this.wasmReal[i] = input[i];
            this.wasmImag[i] = 0;
        }

        // Call WASM fftForward
        this.wasmModule.fftForward(
            this.realPtr!,
            this.imagPtr!,
            this.size,
            this.bitReversedIndices.byteOffset,
            this.twiddleReal.byteOffset,
            this.twiddleImag.byteOffset
        );

        // Compute magnitude and phase using WASM
        this.wasmModule.computeMagnitude(
            this.realPtr!,
            this.imagPtr!,
            this.magnitudePtr!,
            halfSize
        );

        this.wasmModule.computePhase(
            this.realPtr!,
            this.imagPtr!,
            this.phasePtr!,
            halfSize
        );

        // Copy results back to JS
        const magnitude = new Float32Array(halfSize);
        const phase = new Float32Array(halfSize);
        magnitude.set(this.wasmMagnitude);
        phase.set(this.wasmPhase);

        return {
            magnitude,
            phase,
            frequencies: new Float32Array(halfSize)
        };
    }

    /**
     * JavaScript fallback forward FFT
     */
    private forwardJs(input: Float32Array): FFTResult {
        if (input.length !== this.size) {
            throw new Error(`Input length ${input.length} does not match FFT size ${this.size}`);
        }

        // Create complex arrays
        const real = new Float32Array(this.size);
        const imag = new Float32Array(this.size);

        // Copy input and apply bit-reversal permutation
        for (let i = 0; i < this.size; i++) {
            real[this.bitReversedIndices[i]] = input[i];
            imag[this.bitReversedIndices[i]] = 0;
        }

        // Cooley-Tukey butterfly operations
        for (let stage = 1; stage < this.size; stage <<= 1) {
            const step = stage << 1;
            const twiddleStep = this.size / step;

            for (let group = 0; group < stage; group++) {
                const twiddleIdx = group * twiddleStep;
                const wr = this.twiddleReal[twiddleIdx];
                const wi = this.twiddleImag[twiddleIdx];

                for (let pair = group; pair < this.size; pair += step) {
                    const evenIdx = pair;
                    const oddIdx = pair + stage;

                    const evenReal = real[evenIdx];
                    const evenImag = imag[evenIdx];
                    const oddReal = real[oddIdx];
                    const oddImag = imag[oddIdx];

                    // Butterfly: even + twiddle * odd
                    const twiddledOddReal = wr * oddReal - wi * oddImag;
                    const twiddledOddImag = wr * oddImag + wi * oddReal;

                    real[evenIdx] = evenReal + twiddledOddReal;
                    imag[evenIdx] = evenImag + twiddledOddImag;
                    real[oddIdx] = evenReal - twiddledOddReal;
                    imag[oddIdx] = evenImag - twiddledOddImag;
                }
            }
        }

        // Compute magnitude and phase (only first half for real input)
        const halfSize = Math.floor(this.size / 2) + 1;
        const magnitude = new Float32Array(halfSize);
        const phase = new Float32Array(halfSize);

        for (let i = 0; i < halfSize; i++) {
            magnitude[i] = Math.sqrt(real[i] * real[i] + imag[i] * imag[i]);
            phase[i] = Math.atan2(imag[i], real[i]);
        }

        return {
            magnitude,
            phase,
            frequencies: new Float32Array(halfSize)
        };
    }

    /**
     * Compute magnitude spectrum only (faster if phase not needed)
     * @param input Real-valued input signal
     * @returns Magnitude spectrum
     */
    magnitude(input: Float32Array): Float32Array {
        const result = this.forward(input);
        return result.magnitude;
    }

    /**
     * Get the FFT size
     */
    getSize(): number {
        return this.size;
    }

    /**
     * Get frequency bin centers for a given sample rate
     * @param sampleRate Sample rate in Hz
     * @returns Array of frequency bin centers
     */
    getFrequencies(sampleRate: number): Float32Array {
        const halfSize = Math.floor(this.size / 2) + 1;
        const freqs = new Float32Array(halfSize);
        const binWidth = sampleRate / this.size;
        
        for (let i = 0; i < halfSize; i++) {
            freqs[i] = i * binWidth;
        }
        
        return freqs;
    }

    /**
     * Apply Hann window to input signal using WASM if available
     * @param input Input signal
     * @returns Windowed signal
     */
    applyHannWindow(input: Float32Array): Float32Array {
        if (this.useWasm && this.wasmModule && this.wasmReal) {
            return this.applyHannWindowWasm(input);
        }
        return this.applyHannWindowJs(input);
    }

    /**
     * WASM-accelerated Hann window
     */
    private applyHannWindowWasm(input: Float32Array): Float32Array {
        if (!this.wasmModule || !this.wasmReal) {
            throw new Error('WASM buffers not initialized');
        }

        const n = input.length;
        
        // Copy input to WASM buffer
        for (let i = 0; i < n; i++) {
            this.wasmReal[i] = input[i];
        }

        // Apply window using WASM
        this.wasmModule.applyHannWindow(
            this.realPtr!,
            this.realPtr!,
            n
        );

        // Copy result back
        const output = new Float32Array(n);
        for (let i = 0; i < n; i++) {
            output[i] = this.wasmReal![i];
        }

        return output;
    }

    /**
     * JavaScript fallback Hann window
     */
    private applyHannWindowJs(input: Float32Array): Float32Array {
        const output = new Float32Array(input.length);
        const n = input.length;
        
        for (let i = 0; i < n; i++) {
            const windowVal = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
            output[i] = input[i] * windowVal;
        }
        
        return output;
    }

    /**
     * Create a Hann window of specified size
     * @param size Window size
     * @returns Window coefficients
     */
    static createHannWindow(size: number): Float32Array {
        const window = new Float32Array(size);
        
        for (let i = 0; i < size; i++) {
            window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (size - 1)));
        }
        
        return window;
    }

    /**
     * Dispose of WASM resources
     */
    dispose(): void {
        this.freeWasmBuffers();
    }
}

/**
 * Spectral flux calculation between consecutive frames
 * @param prevMagnitude Previous frame's magnitude spectrum
 * @param currMagnitude Current frame's magnitude spectrum
 * @returns Spectral flux value
 */
export function calculateSpectralFlux(
    prevMagnitude: Float32Array,
    currMagnitude: Float32Array
): number {
    if (prevMagnitude.length !== currMagnitude.length) {
        throw new Error('Magnitude arrays must have same length');
    }

    let flux = 0;
    for (let i = 0; i < currMagnitude.length; i++) {
        const diff = currMagnitude[i] - prevMagnitude[i];
        if (diff > 0) {
            flux += diff;
        }
    }

    return flux / currMagnitude.length;
}

/**
 * Calculate spectral centroid (brightness measure)
 * @param magnitude Magnitude spectrum
 * @param frequencies Frequency bin centers
 * @returns Spectral centroid in Hz
 */
export function calculateSpectralCentroid(
    magnitude: Float32Array,
    frequencies: Float32Array
): number {
    let sumMag = 0;
    let sumWeighted = 0;

    for (let i = 0; i < magnitude.length; i++) {
        sumMag += magnitude[i];
        sumWeighted += magnitude[i] * frequencies[i];
    }

    return sumMag > 0 ? sumWeighted / sumMag : 0;
}

/**
 * Calculate spectral flatness (noisiness vs tonalness)
 * @param magnitude Magnitude spectrum
 * @returns Spectral flatness (0-1, higher = more noise-like)
 */
export function calculateSpectralFlatness(magnitude: Float32Array): number {
    let geometricMean = 0;
    let arithmeticMean = 0;
    let nonZeroCount = 0;

    for (let i = 0; i < magnitude.length; i++) {
        const mag = magnitude[i];
        if (mag > 1e-10) {
            geometricMean += Math.log(mag);
            arithmeticMean += mag;
            nonZeroCount++;
        }
    }

    if (nonZeroCount === 0) return 0;

    geometricMean = Math.exp(geometricMean / nonZeroCount);
    arithmeticMean = arithmeticMean / nonZeroCount;

    return arithmeticMean > 0 ? geometricMean / arithmeticMean : 0;
}
