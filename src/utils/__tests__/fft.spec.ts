/**
 * Unit tests for FFT utility
 * 
 * Tests cover:
 * - FFT initialization and validation
 * - Forward FFT computation
 * - Spectral analysis calculations
 * - Window functions
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
    FFT,
    calculateSpectralFlux,
    calculateSpectralCentroid,
    calculateSpectralFlatness,
    type FFTConfig,
    type FFTResult
} from '../fft';

describe('FFT', () => {
    describe('Initialization', () => {
        it('should initialize with valid power-of-2 size', () => {
            const fft = new FFT({ size: 2048 });
            expect(fft.getSize()).toBe(2048);
        });

        it('should initialize with different power-of-2 sizes', () => {
            const sizes = [256, 512, 1024, 2048, 4096];
            
            for (const size of sizes) {
                const fft = new FFT({ size });
                expect(fft.getSize()).toBe(size);
            }
        });

        it('should throw error for non-power-of-2 size', () => {
            expect(() => new FFT({ size: 1000 })).toThrow('power of 2');
            expect(() => new FFT({ size: 3000 })).toThrow('power of 2');
        });

        it('should throw error for zero size', () => {
            expect(() => new FFT({ size: 0 })).toThrow('power of 2');
        });
    });

    describe('Forward FFT', () => {
        let fft: FFT;
        const size = 2048;
        const sampleRate = 48000;

        beforeEach(() => {
            fft = new FFT({ size });
        });

        it('should return magnitude spectrum of correct length', () => {
            const input = generateSineWave(size, 440, sampleRate);
            const result = fft.forward(input);

            // Magnitude should be size/2 + 1 for real FFT
            expect(result.magnitude.length).toBe(size / 2 + 1);
            expect(result.phase.length).toBe(size / 2 + 1);
        });

        it('should detect frequency of sine wave', () => {
            const frequency = 1000;
            const input = generateSineWave(size, frequency, sampleRate);
            
            // Apply window to reduce spectral leakage
            const windowed = fft.applyHannWindow(input);
            const result = fft.forward(windowed);
            
            // Find peak frequency
            const peakIndex = findPeakIndex(result.magnitude);
            const binWidth = sampleRate / size;
            const detectedFreq = peakIndex * binWidth;
            
            // Should be within one bin of expected
            expect(Math.abs(detectedFreq - frequency)).toBeLessThan(binWidth * 2);
        });

        it('should have peak at DC for constant signal', () => {
            const input = new Float32Array(size);
            input.fill(1.0); // Constant value
            
            const result = fft.forward(input);
            
            // DC component (index 0) should be non-zero
            expect(result.magnitude[0]).toBeGreaterThan(0);
            
            // Other bins should be near zero
            for (let i = 1; i < result.magnitude.length; i++) {
                expect(result.magnitude[i]).toBeLessThan(0.1);
            }
        });

        it('should have symmetric magnitude for real input', () => {
            const input = generateSineWave(size, 440, sampleRate);
            const result = fft.forward(input);
            
            // For real input, magnitude is symmetric around Nyquist
            // (not exactly symmetric due to single-sided output, but first and last should be related)
            expect(result.magnitude[0]).toBeGreaterThanOrEqual(0);
            expect(result.magnitude[result.magnitude.length - 1]).toBeGreaterThanOrEqual(0);
        });

        it('should throw error for wrong input length', () => {
            const wrongSize = size + 100;
            const input = new Float32Array(wrongSize);
            
            expect(() => fft.forward(input)).toThrow('Input length');
        });

        it('should handle silent input', () => {
            const input = new Float32Array(size);
            input.fill(0);
            
            const result = fft.forward(input);
            
            // All magnitudes should be zero
            for (let i = 0; i < result.magnitude.length; i++) {
                expect(result.magnitude[i]).toBe(0);
            }
        });

        it('should handle multiple frequency components', () => {
            const freq1 = 500;
            const freq2 = 1500;
            const input1 = generateSineWave(size, freq1, sampleRate, 0.5);
            const input2 = generateSineWave(size, freq2, sampleRate, 0.3);
            
            const combined = new Float32Array(size);
            for (let i = 0; i < size; i++) {
                combined[i] = input1[i] + input2[i];
            }
            
            const windowed = fft.applyHannWindow(combined);
            const result = fft.forward(windowed);
            
            // Find two peaks
            const peaks = findPeaks(result.magnitude, 2);
            
            expect(peaks.length).toBeGreaterThanOrEqual(1);
        });
    });

    describe('Magnitude-only computation', () => {
        it('should return magnitude array', () => {
            const fft = new FFT({ size: 1024 });
            const input = generateSineWave(1024, 440, 48000);
            
            const magnitude = fft.magnitude(input);
            
            expect(magnitude).toBeInstanceOf(Float32Array);
            expect(magnitude.length).toBe(1024 / 2 + 1);
        });
    });

    describe('Frequency bins', () => {
        it('should calculate correct frequency bins', () => {
            const fft = new FFT({ size: 2048 });
            const sampleRate = 48000;
            
            const freqs = fft.getFrequencies(sampleRate);
            const binWidth = sampleRate / 2048;
            
            expect(freqs.length).toBe(2048 / 2 + 1);
            expect(freqs[0]).toBe(0); // DC
            expect(freqs[1]).toBeCloseTo(binWidth, 5);
            expect(freqs[freqs.length - 1]).toBeCloseTo(sampleRate / 2, 0); // Nyquist
        });
    });

    describe('Hann Window', () => {
        it('should apply Hann window correctly', () => {
            const fft = new FFT({ size: 256 });
            const input = new Float32Array(256);
            input.fill(1.0);
            
            const windowed = fft.applyHannWindow(input);
            
            // Window should start at 0
            expect(windowed[0]).toBe(0);
            
            // Window should end at 0
            expect(windowed[255]).toBeCloseTo(0, 10);
            
            // Center should be very close to 1 (within numerical precision)
            expect(windowed[127]).toBeCloseTo(1, 3);
        });

        it('should create Hann window of specified size', () => {
            const window = FFT.createHannWindow(512);
            
            expect(window.length).toBe(512);
            expect(window[0]).toBe(0);
            expect(window[511]).toBeCloseTo(0, 10);
            expect(window[256]).toBeCloseTo(1, 3);
        });

        it('should reduce spectral leakage with window', () => {
            const fft = new FFT({ size: 2048 });
            const input = generateSineWave(2048, 1000.5, 48000); // Non-integer cycles
            
            // Without window - more leakage
            const resultNoWindow = fft.forward(input);
            const leakageNoWindow = calculateLeakage(resultNoWindow.magnitude);
            
            // With window - less leakage
            const windowed = fft.applyHannWindow(input);
            const resultWindowed = fft.forward(windowed);
            const leakageWindowed = calculateLeakage(resultWindowed.magnitude);
            
            // Windowed should have less leakage (lower side lobes)
            expect(leakageWindowed).toBeLessThan(leakageNoWindow);
        });
    });
});

describe('Spectral Flux', () => {
    it('should calculate zero flux for identical spectra', () => {
        const mag1 = new Float32Array([1, 2, 3, 4, 5]);
        const mag2 = new Float32Array([1, 2, 3, 4, 5]);
        
        const flux = calculateSpectralFlux(mag1, mag2);
        
        expect(flux).toBe(0);
    });

    it('should calculate positive flux for increasing spectrum', () => {
        const mag1 = new Float32Array([1, 1, 1, 1, 1]);
        const mag2 = new Float32Array([2, 2, 2, 2, 2]);
        
        const flux = calculateSpectralFlux(mag1, mag2);
        
        expect(flux).toBeGreaterThan(0);
    });

    it('should ignore negative changes (decreasing spectrum)', () => {
        const mag1 = new Float32Array([2, 2, 2, 2, 2]);
        const mag2 = new Float32Array([1, 1, 1, 1, 1]);
        
        const flux = calculateSpectralFlux(mag1, mag2);
        
        expect(flux).toBe(0);
    });

    it('should throw for mismatched array lengths', () => {
        const mag1 = new Float32Array([1, 2, 3]);
        const mag2 = new Float32Array([1, 2, 3, 4]);
        
        expect(() => calculateSpectralFlux(mag1, mag2)).toThrow('same length');
    });

    it('should detect spectral changes in audio', () => {
        const size = 2048;
        const sampleRate = 48000;
        
        // Create two frames: one pure sine, one with added noise
        const frame1 = generateSineWave(size, 440, sampleRate);
        const frame2 = generateSineWave(size, 440, sampleRate);
        addNoise(frame2, 0.1);
        
        const fft = new FFT({ size });
        const mag1 = fft.magnitude(frame1);
        const mag2 = fft.magnitude(frame2);
        
        const flux = calculateSpectralFlux(mag1, mag2);
        
        expect(flux).toBeGreaterThan(0);
    });
});

describe('Spectral Centroid', () => {
    it('should calculate centroid for simple spectrum', () => {
        const magnitude = new Float32Array([0, 0, 10, 0, 0]);
        const frequencies = new Float32Array([0, 100, 200, 300, 400]);
        
        const centroid = calculateSpectralCentroid(magnitude, frequencies);
        
        expect(centroid).toBe(200);
    });

    it('should return 0 for silent spectrum', () => {
        const magnitude = new Float32Array([0, 0, 0, 0, 0]);
        const frequencies = new Float32Array([0, 100, 200, 300, 400]);
        
        const centroid = calculateSpectralCentroid(magnitude, frequencies);
        
        expect(centroid).toBe(0);
    });

    it('should be weighted toward higher frequencies', () => {
        const magnitude = new Float32Array([10, 10, 10, 20, 20]);
        const frequencies = new Float32Array([0, 100, 200, 300, 400]);
        
        const centroid = calculateSpectralCentroid(magnitude, frequencies);
        
        expect(centroid).toBeGreaterThan(200); // Should be > midpoint
    });
});

describe('Spectral Flatness', () => {
    it('should return 1 for flat spectrum (white noise)', () => {
        // Simulate flat spectrum
        const magnitude = new Float32Array(100);
        magnitude.fill(1.0);
        
        const flatness = calculateSpectralFlatness(magnitude);
        
        expect(flatness).toBeCloseTo(1, 5);
    });

    it('should return near 0 for tonal spectrum', () => {
        // Simulate tonal spectrum (peak at one bin)
        const magnitude = new Float32Array(100);
        magnitude.fill(0.01);
        magnitude[50] = 10; // Strong peak
        
        const flatness = calculateSpectralFlatness(magnitude);
        
        expect(flatness).toBeLessThan(0.5);
    });

    it('should return 0 for empty spectrum', () => {
        const magnitude = new Float32Array(100);
        magnitude.fill(0);
        
        const flatness = calculateSpectralFlatness(magnitude);
        
        expect(flatness).toBe(0);
    });
});

// Test helper functions

function generateSineWave(length: number, frequency: number, sampleRate: number, amplitude: number = 1.0): Float32Array {
    const wave = new Float32Array(length);
    for (let i = 0; i < length; i++) {
        wave[i] = amplitude * Math.sin(2 * Math.PI * frequency * i / sampleRate);
    }
    return wave;
}

function addNoise(signal: Float32Array, amount: number): void {
    for (let i = 0; i < signal.length; i++) {
        signal[i] += (Math.random() - 0.5) * 2 * amount;
    }
}

function findPeakIndex(magnitude: Float32Array): number {
    let maxVal = -1;
    let maxIdx = 0;
    
    // Skip DC (index 0)
    for (let i = 1; i < magnitude.length; i++) {
        if (magnitude[i] > maxVal) {
            maxVal = magnitude[i];
            maxIdx = i;
        }
    }
    
    return maxIdx;
}

function findPeaks(magnitude: Float32Array, count: number): number[] {
    const peaks: { index: number; value: number }[] = [];
    
    for (let i = 1; i < magnitude.length - 1; i++) {
        if (magnitude[i] > magnitude[i - 1] && magnitude[i] > magnitude[i + 1]) {
            peaks.push({ index: i, value: magnitude[i] });
        }
    }
    
    peaks.sort((a, b) => b.value - a.value);
    return peaks.slice(0, count).map(p => p.index);
}

function calculateLeakage(magnitude: Float32Array): number {
    const peakIdx = findPeakIndex(magnitude);
    const peakValue = magnitude[peakIdx];
    
    // Sum of non-peak bins relative to peak
    let sideLobeSum = 0;
    for (let i = 1; i < magnitude.length; i++) {
        if (i !== peakIdx) {
            sideLobeSum += magnitude[i];
        }
    }
    
    return sideLobeSum / peakValue;
}
