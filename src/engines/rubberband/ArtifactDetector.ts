/**
 * ArtifactDetector - Real-time audio quality monitoring and artifact mitigation
 * 
 * Part of RUBBERBAND_ENHANCEMENT_PLAN Section 10: Quality Assurance
 * 
 * Provides:
 * - FFT-based spectral flux analysis for detecting metallic artifacts
 * - Real-time artifact threshold detection with adaptive thresholding
 * - Automatic dry/wet blend fallback for artifact mitigation
 * - Quality metrics and reporting via postMessage
 * - Low-latency design for real-time processing
 * 
 * @see RUBBERBAND_ENHANCEMENT_PLAN.md Section 10
 */

import { FFT, calculateSpectralFlux, calculateSpectralCentroid, calculateSpectralFlatness } from '../../utils/fft';

/** Artifact detection result */
export interface ArtifactDetection {
    /** Whether an artifact was detected */
    detected: boolean;
    /** Severity level (0.0 - 1.0) */
    severity: number;
    /** Type of artifact detected */
    type: 'metallic' | 'phasing' | 'dropout' | 'distortion' | 'none';
    /** Timestamp of detection (performance.now()) */
    timestamp: number;
    /** Frequency region where artifact was detected (Hz) */
    frequencyRegion?: number;
    /** Additional metadata for debugging */
    metadata?: Record<string, number>;
}

/** Quality metrics for audio analysis */
export interface QualityMetrics {
    /** Spectral flux (rate of spectral change) */
    spectralFlux: number;
    /** Zero crossing rate */
    zeroCrossingRate: number;
    /** RMS level */
    rmsLevel: number;
    /** Peak level */
    peakLevel: number;
    /** Spectral centroid (brightness) in Hz */
    spectralCentroid: number;
    /** Spectral flatness (0-1, higher = more noise-like) */
    spectralFlatness: number;
    /** Crest factor (peak/RMS ratio) */
    crestFactor: number;
    /** Estimated signal quality (0.0 - 1.0) */
    quality: number;
}

/** Configuration for artifact detector */
export interface ArtifactDetectorConfig {
    /** Sample rate for analysis */
    sampleRate: number;
    /** FFT size for spectral analysis (must be power of 2) */
    fftSize: number;
    /** Hop size for overlap-add analysis */
    hopSize: number;
    /** Threshold for artifact detection (0.0 - 1.0) */
    artifactThreshold: number;
    /** Adaptive threshold factor (multiplies running average) */
    adaptiveThresholdFactor: number;
    /** Blend amount with dry signal on artifact (0.0 - 1.0) */
    fallbackBlend: number;
    /** Attack time for blend smoothing (samples) */
    blendAttackSamples: number;
    /** Release time for blend smoothing (samples) */
    blendReleaseSamples: number;
    /** Enable adaptive thresholding */
    enableAdaptiveThreshold: boolean;
    /** History size for running statistics */
    historySize: number;
    /** Minimum frequency for artifact detection (Hz) */
    minFrequency: number;
    /** Maximum frequency for artifact detection (Hz) */
    maxFrequency: number;
}

/** Default artifact detector configuration */
export const DEFAULT_ARTIFACT_CONFIG: ArtifactDetectorConfig = {
    sampleRate: 48000,
    fftSize: 2048,
    hopSize: 512,
    artifactThreshold: 0.7,
    adaptiveThresholdFactor: 1.5,
    fallbackBlend: 0.3,
    blendAttackSamples: 64,
    blendReleaseSamples: 512,
    enableAdaptiveThreshold: true,
    historySize: 50,
    minFrequency: 1000,
    maxFrequency: 16000
};

/** PostMessage types for ArtifactDetectorWorker */
export type ArtifactDetectorMessageType = 
    | 'artifact-detected'
    | 'quality-update'
    | 'config-update'
    | 'statistics'
    | 'error';

/** Message payload for postMessage reporting */
export interface ArtifactDetectorMessage {
    type: ArtifactDetectorMessageType;
    data: ArtifactDetection | QualityMetrics | ArtifactDetectorConfig | ArtifactStatistics | string;
    timestamp: number;
}

/** Statistics for artifact detection */
export interface ArtifactStatistics {
    totalAnalyzed: number;
    artifactRate: number;
    averageSeverity: number;
    recentArtifacts: ArtifactDetection[];
    qualityTrend: number[];
}

/** Event callback type */
export type ArtifactCallback = (detection: ArtifactDetection) => void;
export type QualityCallback = (metrics: QualityMetrics) => void;

/**
 * ArtifactDetector class for monitoring audio quality.
 * 
 * Implements FFT-based spectral analysis for detecting artifacts in pitch-shifted audio.
 * Optimized for real-time performance with low latency.
 */
export class ArtifactDetector {
    private config: ArtifactDetectorConfig;
    private fft: FFT;
    private hannWindow: Float32Array;
    
    // State for spectral analysis
    private prevMagnitude: Float32Array | null = null;
    private frequencyBins: Float32Array;
    private minBinIndex: number;
    private maxBinIndex: number;
    
    // Running statistics for adaptive thresholding
    private fluxHistory: number[] = [];
    private qualityHistory: number[] = [];
    private artifactHistory: ArtifactDetection[] = [];
    
    // Blend smoothing state
    private currentBlend: number = 0;
    private blendAttackCoeff: number;
    private blendReleaseCoeff: number;
    
    // Event callbacks
    private artifactCallbacks: Set<ArtifactCallback> = new Set();
    private qualityCallbacks: Set<QualityCallback> = new Set();
    
    // Analysis buffer for overlap-add
    private analysisBuffer: Float32Array;
    private bufferIndex: number = 0;

    /**
     * Create a new ArtifactDetector
     * @param config Partial configuration (defaults applied for missing values)
     */
    constructor(config: Partial<ArtifactDetectorConfig> = {}) {
        this.config = { ...DEFAULT_ARTIFACT_CONFIG, ...config };
        
        // Validate FFT size
        if (!this.isPowerOfTwo(this.config.fftSize)) {
            throw new Error(`FFT size must be power of 2, got ${this.config.fftSize}`);
        }
        
        // Initialize FFT
        this.fft = new FFT({ size: this.config.fftSize });
        
        // Create Hann window
        this.hannWindow = FFT.createHannWindow(this.config.fftSize);
        
        // Get frequency bins
        this.frequencyBins = this.fft.getFrequencies(this.config.sampleRate);
        
        // Calculate bin indices for frequency range
        const binWidth = this.config.sampleRate / this.config.fftSize;
        this.minBinIndex = Math.floor(this.config.minFrequency / binWidth);
        this.maxBinIndex = Math.min(
            Math.ceil(this.config.maxFrequency / binWidth),
            this.frequencyBins.length - 1
        );
        
        // Initialize blend coefficients
        this.blendAttackCoeff = 1 - Math.exp(-1 / this.config.blendAttackSamples);
        this.blendReleaseCoeff = 1 - Math.exp(-1 / this.config.blendReleaseSamples);
        
        // Initialize analysis buffer
        this.analysisBuffer = new Float32Array(this.config.fftSize);
    }

    /**
     * Check if number is power of 2
     */
    private isPowerOfTwo(n: number): boolean {
        return (n & (n - 1)) === 0 && n > 0;
    }

    /**
     * Analyze an audio buffer for artifacts using FFT-based spectral flux.
     * 
     * @param audio Audio buffer to analyze
     * @returns Artifact detection result
     */
    analyze(audio: Float32Array): ArtifactDetection {
        // Calculate metrics with FFT
        const metrics = this.calculateMetricsWithFFT(audio);
        
        // Get adaptive threshold
        const threshold = this.getAdaptiveThreshold();
        
        // Detect artifact based on spectral flux and other indicators
        const detected = metrics.spectralFlux > threshold || 
                        (metrics.spectralFlatness > 0.8 && metrics.crestFactor > 10);
        
        // Calculate severity
        let severity = 0;
        if (detected) {
            severity = Math.min(1, metrics.spectralFlux / threshold);
        }
        
        // Determine artifact type
        let type: ArtifactDetection['type'] = 'none';
        if (detected) {
            if (metrics.spectralFlatness > 0.7) {
                type = 'metallic';
            } else if (metrics.crestFactor > 15) {
                type = 'distortion';
            } else if (metrics.spectralCentroid > 8000) {
                type = 'phasing';
            } else {
                type = 'dropout';
            }
        }

        // Create detection result
        const result: ArtifactDetection = {
            detected,
            severity,
            type,
            timestamp: performance.now(),
            frequencyRegion: detected ? metrics.spectralCentroid : undefined,
            metadata: {
                threshold,
                flux: metrics.spectralFlux,
                flatness: metrics.spectralFlatness,
                crestFactor: metrics.crestFactor
            }
        };

        // Update history
        this.updateHistory(result, metrics);
        
        // Trigger callbacks if artifact detected
        if (detected) {
            this.notifyArtifactCallbacks(result);
        }
        this.notifyQualityCallbacks(metrics);

        return result;
    }

    /**
     * Process audio block with overlap-add for continuous analysis.
     * Optimized for real-time processing in AudioWorklet.
     * 
     * @param inputBlock Input audio block (typically 128 samples for Web Audio)
     * @returns Latest artifact detection
     */
    processBlock(inputBlock: Float32Array): ArtifactDetection {
        // Copy new samples into analysis buffer
        for (let i = 0; i < inputBlock.length; i++) {
            this.analysisBuffer[this.bufferIndex] = inputBlock[i];
            this.bufferIndex++;
            
            // When buffer is full, analyze and shift
            if (this.bufferIndex >= this.config.fftSize) {
                const detection = this.analyze(this.analysisBuffer);
                
                // Shift by hop size for overlap-add
                const shiftAmount = this.config.hopSize;
                this.analysisBuffer.copyWithin(0, shiftAmount);
                this.bufferIndex = this.config.fftSize - shiftAmount;
                
                // Zero out the end
                this.analysisBuffer.fill(0, this.bufferIndex);
                
                return detection;
            }
        }
        
        // Return non-detection if buffer not full yet
        return {
            detected: false,
            severity: 0,
            type: 'none',
            timestamp: performance.now()
        };
    }

    /**
     * Calculate quality metrics using FFT-based spectral analysis.
     */
    private calculateMetricsWithFFT(audio: Float32Array): QualityMetrics {
        // Ensure audio is correct length
        if (audio.length !== this.config.fftSize) {
            const padded = new Float32Array(this.config.fftSize);
            padded.set(audio.subarray(0, Math.min(audio.length, this.config.fftSize)));
            audio = padded;
        }

        // Apply Hann window
        const windowed = new Float32Array(this.config.fftSize);
        for (let i = 0; i < this.config.fftSize; i++) {
            windowed[i] = audio[i] * this.hannWindow[i];
        }

        // Compute FFT
        const fftResult = this.fft.forward(windowed);
        const magnitude = fftResult.magnitude;

        // Calculate spectral flux
        let spectralFlux = 0;
        if (this.prevMagnitude) {
            spectralFlux = calculateSpectralFlux(this.prevMagnitude, magnitude);
        }
        this.prevMagnitude = new Float32Array(magnitude);

        // Calculate spectral centroid
        const spectralCentroid = calculateSpectralCentroid(magnitude, this.frequencyBins);

        // Calculate spectral flatness
        const spectralFlatness = calculateSpectralFlatness(magnitude);

        // Calculate time-domain metrics
        let sumSquares = 0;
        let peak = 0;
        let zeroCrossings = 0;
        let prevSign = audio[0] >= 0 ? 1 : -1;

        for (let i = 0; i < audio.length; i++) {
            const sample = audio[i];
            sumSquares += sample * sample;
            peak = Math.max(peak, Math.abs(sample));

            const sign = sample >= 0 ? 1 : -1;
            if (sign !== prevSign && i > 0) {
                zeroCrossings++;
            }
            prevSign = sign;
        }

        const rmsLevel = Math.sqrt(sumSquares / audio.length);
        const zeroCrossingRate = zeroCrossings / audio.length;
        const crestFactor = rmsLevel > 0 ? peak / rmsLevel : 0;

        // Quality estimate based on multiple factors
        const quality = Math.max(0, 1 - spectralFlux * 2 - spectralFlatness * 0.5);

        return {
            spectralFlux,
            zeroCrossingRate,
            rmsLevel,
            peakLevel: peak,
            spectralCentroid,
            spectralFlatness,
            crestFactor,
            quality
        };
    }

    /**
     * Get adaptive threshold based on running statistics.
     */
    private getAdaptiveThreshold(): number {
        if (!this.config.enableAdaptiveThreshold || this.fluxHistory.length < 10) {
            return this.config.artifactThreshold;
        }

        // Calculate running mean and std dev
        // ⚡ Bolt Optimization: Replace reduce with traditional for loop to avoid closure allocation
        let sum = 0;
        for (let i = 0; i < this.fluxHistory.length; i++) {
            sum += this.fluxHistory[i];
        }
        const mean = sum / this.fluxHistory.length;

        let varianceSum = 0;
        for (let i = 0; i < this.fluxHistory.length; i++) {
            varianceSum += (this.fluxHistory[i] - mean) ** 2;
        }
        const variance = varianceSum / this.fluxHistory.length;
        const stdDev = Math.sqrt(variance);

        // Adaptive threshold = mean + factor * stdDev
        return Math.min(1, (mean + stdDev) * this.config.adaptiveThresholdFactor);
    }

    /**
     * Update history buffers.
     */
    private updateHistory(detection: ArtifactDetection, metrics: QualityMetrics): void {
        // Update flux history
        this.fluxHistory.push(metrics.spectralFlux);
        if (this.fluxHistory.length > this.config.historySize) {
            this.fluxHistory.shift();
        }

        // Update quality history
        this.qualityHistory.push(metrics.quality);
        if (this.qualityHistory.length > this.config.historySize) {
            this.qualityHistory.shift();
        }

        // Update artifact history
        if (detection.detected) {
            this.artifactHistory.push(detection);
            if (this.artifactHistory.length > this.config.historySize) {
                this.artifactHistory.shift();
            }
        }
    }

    /**
     * Apply artifact mitigation by blending with dry signal.
     * Uses smooth attack/release for blend amount to avoid clicks.
     * 
     * @param processed Processed (potentially artifact-laden) audio
     * @param dry Original dry audio
     * @param detection Artifact detection result
     * @returns Mitigated audio
     */
    mitigate(
        processed: Float32Array,
        dry: Float32Array,
        detection: ArtifactDetection
    ): Float32Array {
        const targetBlend = detection.detected 
            ? this.config.fallbackBlend * detection.severity 
            : 0;

        // Smooth blend amount (attack/release)
        const coeff = targetBlend > this.currentBlend 
            ? this.blendAttackCoeff 
            : this.blendReleaseCoeff;
        this.currentBlend += (targetBlend - this.currentBlend) * coeff;

        // If no blend needed, return processed directly
        if (this.currentBlend < 0.001) {
            return processed;
        }

        // Apply blend
        const output = new Float32Array(processed.length);
        const blend = this.currentBlend;
        const processedWeight = 1 - blend;

        for (let i = 0; i < processed.length; i++) {
            const dryVal = i < dry.length ? dry[i] : 0;
            output[i] = processed[i] * processedWeight + dryVal * blend;
        }

        return output;
    }

    /**
     * Real-time mitigation that processes samples in place.
     * Optimized for AudioWorklet use.
     * 
     * @param processed Output buffer (modified in place)
     * @param dry Dry signal buffer
     * @param detection Artifact detection result
     */
    mitigateInPlace(
        processed: Float32Array,
        dry: Float32Array,
        detection: ArtifactDetection
    ): void {
        const targetBlend = detection.detected 
            ? this.config.fallbackBlend * detection.severity 
            : 0;

        // Smooth blend amount
        const coeff = targetBlend > this.currentBlend 
            ? this.blendAttackCoeff 
            : this.blendReleaseCoeff;
        this.currentBlend += (targetBlend - this.currentBlend) * coeff;

        // Apply blend in place
        if (this.currentBlend > 0.001) {
            const blend = this.currentBlend;
            const processedWeight = 1 - blend;

            for (let i = 0; i < processed.length; i++) {
                const dryVal = i < dry.length ? dry[i] : 0;
                processed[i] = processed[i] * processedWeight + dryVal * blend;
            }
        }
    }

    /**
     * Get artifact detection statistics.
     */
    getStatistics(): ArtifactStatistics {
        // ⚡ Bolt Optimization: Replace filter and reduce with traditional for loop to avoid closure allocation
        let detectedCount = 0;
        let severitySum = 0;

        for (let i = 0; i < this.artifactHistory.length; i++) {
            const a = this.artifactHistory[i];
            if (a.detected) {
                detectedCount++;
                severitySum += a.severity;
            }
        }
        
        return {
            totalAnalyzed: this.artifactHistory.length,
            artifactRate: this.artifactHistory.length > 0 
                ? detectedCount / this.artifactHistory.length
                : 0,
            averageSeverity: detectedCount > 0
                ? severitySum / detectedCount
                : 0,
            recentArtifacts: [...this.artifactHistory.slice(-10)],
            qualityTrend: [...this.qualityHistory]
        };
    }

    /**
     * Clear artifact history.
     */
    clearHistory(): void {
        this.artifactHistory = [];
        this.fluxHistory = [];
        this.qualityHistory = [];
        this.currentBlend = 0;
        this.prevMagnitude = null;
        this.bufferIndex = 0;
    }

    /**
     * Register callback for artifact detection events.
     * @param callback Function to call on artifact detection
     */
    onArtifact(callback: ArtifactCallback): () => void {
        this.artifactCallbacks.add(callback);
        return () => this.artifactCallbacks.delete(callback);
    }

    /**
     * Register callback for quality metrics updates.
     * @param callback Function to call on quality update
     */
    onQualityUpdate(callback: QualityCallback): () => void {
        this.qualityCallbacks.add(callback);
        return () => this.qualityCallbacks.delete(callback);
    }

    /**
     * Notify artifact callbacks.
     */
    private notifyArtifactCallbacks(detection: ArtifactDetection): void {
        for (const callback of this.artifactCallbacks) {
            try {
                callback(detection);
            } catch (e) {
                console.error('Artifact callback error:', e);
            }
        }
    }

    /**
     * Notify quality callbacks.
     */
    private notifyQualityCallbacks(metrics: QualityMetrics): void {
        for (const callback of this.qualityCallbacks) {
            try {
                callback(metrics);
            } catch (e) {
                console.error('Quality callback error:', e);
            }
        }
    }

    /**
     * Update configuration at runtime.
     * @param updates Partial configuration updates
     */
    updateConfig(updates: Partial<ArtifactDetectorConfig>): void {
        this.config = { ...this.config, ...updates };
        
        // Recalculate blend coefficients if changed
        if (updates.blendAttackSamples) {
            this.blendAttackCoeff = 1 - Math.exp(-1 / this.config.blendAttackSamples);
        }
        if (updates.blendReleaseSamples) {
            this.blendReleaseCoeff = 1 - Math.exp(-1 / this.config.blendReleaseSamples);
        }
    }

    /**
     * Get current configuration.
     */
    getConfig(): Readonly<ArtifactDetectorConfig> {
        return { ...this.config };
    }

    /**
     * Create a postMessage payload for main thread communication.
     * @param type Message type
     * @param data Message data
     */
    createMessage(
        type: ArtifactDetectorMessageType,
        data: ArtifactDetectorMessage['data']
    ): ArtifactDetectorMessage {
        return {
            type,
            data,
            timestamp: performance.now()
        };
    }

    /**
     * Serialize detection for postMessage.
     * @param detection Detection result
     */
    serializeDetection(detection: ArtifactDetection): string {
        return JSON.stringify(detection);
    }

    /**
     * Serialize metrics for postMessage.
     * @param metrics Quality metrics
     */
    serializeMetrics(metrics: QualityMetrics): string {
        return JSON.stringify({
            spectralFlux: metrics.spectralFlux,
            zeroCrossingRate: metrics.zeroCrossingRate,
            rmsLevel: metrics.rmsLevel,
            peakLevel: metrics.peakLevel,
            spectralCentroid: metrics.spectralCentroid,
            spectralFlatness: metrics.spectralFlatness,
            crestFactor: metrics.crestFactor,
            quality: metrics.quality
        });
    }
}

export default ArtifactDetector;
