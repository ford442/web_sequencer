/**
 * ArtifactDetectorProcessor - AudioWorklet processor for real-time artifact detection
 * 
 * Part of RUBBERBAND_ENHANCEMENT_PLAN Section 10: Quality Assurance
 * 
 * Runs in the AudioWorklet thread for zero-latency artifact monitoring.
 * Communicates with main thread via postMessage.
 */

import { ArtifactDetector, ArtifactDetectorConfig, DEFAULT_ARTIFACT_CONFIG, ArtifactDetection, QualityMetrics } from '../engines/rubberband/ArtifactDetector';

// AudioWorklet processor interface declarations
declare const globalThis: {
    sampleRate: number;
    currentTime: number;
};

interface AudioWorkletProcessor {
    readonly port: MessagePort;
    process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean;
}

declare var AudioWorkletProcessor: {
    prototype: AudioWorkletProcessor;
    new(options?: any): AudioWorkletProcessor;
};

declare function registerProcessor(name: string, processorCtor: (new (options?: any) => AudioWorkletProcessor)): void;

/**
 * Processor port message types
 */
type ProcessorMessage =
    | { type: 'init'; config?: Partial<ArtifactDetectorConfig> }
    | { type: 'updateConfig'; config: Partial<ArtifactDetectorConfig> }
    | { type: 'getStatistics' }
    | { type: 'clearHistory' }
    | { type: 'enableReporting'; enabled: boolean; interval?: number }
    | { type: 'setDryBuffer'; buffer: ArrayBuffer };

/**
 * ArtifactDetectorProcessor - Real-time artifact detection in AudioWorklet
 * 
 * Features:
 * - Zero-latency artifact detection during pitch shifting
 * - Automatic dry/wet blending when artifacts detected
 * - Periodic quality reports to main thread
 * - Configurable detection thresholds
 */
class ArtifactDetectorProcessor extends AudioWorkletProcessor {
    private detector: ArtifactDetector | null = null;
    private config: Partial<ArtifactDetectorConfig> = {};
    
    // Dry signal buffer for fallback blending
    private dryBuffer: Float32Array | null = null;
    private dryBufferIndex: number = 0;
    
    // Reporting state
    private reportingEnabled: boolean = true;
    private reportIntervalMs: number = 100; // Report every 100ms
    private lastReportTime: number = 0;
    private sampleRate: number = 44100;
    private samplesSinceReport: number = 0;
    
    // Current detection state
    private lastDetection: ArtifactDetection | null = null;
    private lastMetrics: QualityMetrics | null = null;
    
    // Statistics for throttled reporting
    private pendingArtifacts: ArtifactDetection[] = [];
    private qualitySum: number = 0;
    private qualityCount: number = 0;

    constructor() {
        super();
        this.port.onmessage = this.handleMessage.bind(this);
        
        // Get sample rate from global scope
        // @ts-ignore
        this.sampleRate = typeof globalThis.sampleRate === 'number' 
            ? globalThis.sampleRate 
            : 44100;
        
        // Initialize with default config
        this.initializeDetector();
    }

    /**
     * Initialize or reinitialize the detector
     */
    private initializeDetector(): void {
        try {
            const fullConfig: ArtifactDetectorConfig = {
                ...DEFAULT_ARTIFACT_CONFIG,
                ...this.config,
                sampleRate: this.sampleRate
            };
            
            this.detector = new ArtifactDetector(fullConfig);
            this.port.postMessage({
                type: 'initialized',
                config: fullConfig
            });
        } catch (e) {
            this.port.postMessage({
                type: 'error',
                error: `Failed to initialize detector: ${e instanceof Error ? e.message : String(e)}`
            });
        }
    }

    /**
     * Handle messages from main thread
     */
    private handleMessage(event: MessageEvent<ProcessorMessage>): void {
        const data = event.data;

        switch (data.type) {
            case 'init':
                if (data.config) {
                    this.config = { ...this.config, ...data.config };
                }
                this.initializeDetector();
                break;

            case 'updateConfig':
                if (this.detector && data.config) {
                    this.detector.updateConfig(data.config);
                    this.config = { ...this.config, ...data.config };
                    this.port.postMessage({
                        type: 'configUpdated',
                        config: this.detector.getConfig()
                    });
                }
                break;

            case 'getStatistics':
                if (this.detector) {
                    this.port.postMessage({
                        type: 'statistics',
                        stats: this.detector.getStatistics()
                    });
                }
                break;

            case 'clearHistory':
                if (this.detector) {
                    this.detector.clearHistory();
                }
                this.dryBuffer = null;
                this.dryBufferIndex = 0;
                this.pendingArtifacts = [];
                this.port.postMessage({ type: 'historyCleared' });
                break;

            case 'enableReporting':
                this.reportingEnabled = (data as { enabled: boolean; interval?: number }).enabled ?? true;
                const interval = (data as { enabled: boolean; interval?: number }).interval;
                if (interval) {
                    this.reportIntervalMs = interval;
                }
                this.port.postMessage({
                    type: 'reportingUpdated',
                    enabled: this.reportingEnabled,
                    interval: this.reportIntervalMs
                });
                break;

            case 'setDryBuffer':
                const buffer = (data as { buffer: ArrayBuffer }).buffer;
                if (buffer) {
                    this.dryBuffer = new Float32Array(buffer);
                    this.dryBufferIndex = 0;
                }
                break;

            default:
                this.port.postMessage({
                    type: 'error',
                    error: `Unknown message type: ${(data as { type: string }).type}`
                });
        }
    }

    /**
     * Main process loop - called every 128 samples by Web Audio
     */
    process(
        inputs: Float32Array[][],
        outputs: Float32Array[][],
        _parameters: Record<string, Float32Array>
    ): boolean {
        if (!this.detector) {
            // Pass through if not initialized
            if (inputs[0]?.[0] && outputs[0]?.[0]) {
                outputs[0][0].set(inputs[0][0]);
            }
            return true;
        }

        const input = inputs[0]?.[0];
        const output = outputs[0]?.[0];

        if (!input || !output) {
            return true;
        }

        // Store dry signal for potential fallback
        const dryBlock = new Float32Array(input);
        
        // Update dry buffer circular buffer
        if (this.dryBuffer) {
            for (let i = 0; i < dryBlock.length; i++) {
                this.dryBuffer[this.dryBufferIndex] = dryBlock[i];
                this.dryBufferIndex = (this.dryBufferIndex + 1) % this.dryBuffer.length;
            }
        }

        // Copy input to output (will be modified if artifacts detected)
        output.set(input);

        // Process through artifact detector
        const detection = this.detector.processBlock(input);
        this.lastDetection = detection;

        // Apply mitigation if artifacts detected
        if (detection.detected && this.dryBuffer) {
            // Get aligned dry samples
            const alignedDry = this.getAlignedDrySamples(output.length);
            
            // Apply mitigation in place
            this.detector.mitigateInPlace(output, alignedDry, detection);
            
            // Report artifact immediately if severe
            if (detection.severity > 0.7) {
                this.port.postMessage({
                    type: 'artifact-detected',
                    detection: {
                        detected: detection.detected,
                        severity: detection.severity,
                        type: detection.type,
                        timestamp: detection.timestamp,
                        frequencyRegion: detection.frequencyRegion,
                        metadata: detection.metadata
                    }
                });
            } else {
                // Queue for batch reporting
                this.pendingArtifacts.push(detection);
            }
        }

        // Accumulate quality metrics
        if (this.lastMetrics) {
            this.qualitySum += this.lastMetrics.quality;
            this.qualityCount++;
        }

        // Periodic reporting
        this.samplesSinceReport += input.length;
        const reportIntervalSamples = (this.reportIntervalMs / 1000) * this.sampleRate;
        
        if (this.reportingEnabled && this.samplesSinceReport >= reportIntervalSamples) {
            this.sendPeriodicReport();
            this.samplesSinceReport = 0;
        }

        return true;
    }

    /**
     * Get aligned dry samples for blending
     */
    private getAlignedDrySamples(length: number): Float32Array {
        if (!this.dryBuffer) {
            return new Float32Array(length);
        }

        const result = new Float32Array(length);
        const bufferLen = this.dryBuffer.length;
        
        // Read from circular buffer with wraparound
        for (let i = 0; i < length; i++) {
            const idx = (this.dryBufferIndex - length + i + bufferLen) % bufferLen;
            result[i] = this.dryBuffer[idx];
        }

        return result;
    }

    /**
     * Send periodic quality report to main thread
     */
    private sendPeriodicReport(): void {
        if (!this.detector) return;

        const stats = this.detector.getStatistics();
        
        // Average quality over the period
        const avgQuality = this.qualityCount > 0 
            ? this.qualitySum / this.qualityCount 
            : 1.0;

        this.port.postMessage({
            type: 'quality-update',
            quality: avgQuality,
            artifactRate: stats.artifactRate,
            averageSeverity: stats.averageSeverity,
            pendingArtifacts: this.pendingArtifacts.map(a => ({
                detected: a.detected,
                severity: a.severity,
                type: a.type,
                timestamp: a.timestamp
            }))
        });

        // Reset accumulators
        this.pendingArtifacts = [];
        this.qualitySum = 0;
        this.qualityCount = 0;
    }
}

// Register the processor
registerProcessor('ArtifactDetectorProcessor', ArtifactDetectorProcessor);

export { ArtifactDetectorProcessor };
export default ArtifactDetectorProcessor;
