/// <reference lib="webworker" />

import { RingBuffer } from '../utils/ringBuffer';

declare const globalThis: AudioWorkletGlobalScope & {
    createRubberbandModule: () => Promise<any>;
};

/**
 * Rubberband Audio Worklet Processor
 * 
 * Enhanced for vocal synthesis with formant preservation and optimized settings.
 * Part of the RUBBERBAND_ENHANCEMENT_PLAN implementation.
 * 
 * Key vocal optimizations applied:
 * - OptionFormantPreserved: Prevents "chipmunk effect" when pitch shifting vocals
 * - OptionPhaseLaminar: Better phase coherence for monophonic voice
 * - OptionTransientsMixed: Preserves consonant articulation (t, k, etc.)
 * - OptionChannelsTogether: Maintains stereo coherence for stereo sources
 */

/** Configuration for processor quality modes */
interface ProcessorConfig {
    /** Use high quality (Finer engine) for better vocal fidelity */
    useHighQuality: boolean;
    /** Preserve formants to avoid chipmunk effect (CRITICAL for vocals) */
    preserveFormants: boolean;
    /** Number of audio channels */
    channels: number;
}

class RubberbandProcessor extends AudioWorkletProcessor {
    private inputRingBuffer: RingBuffer | null = null;
    private outputRingBuffer: RingBuffer | null = null;
    private rubberband: any = null;
    private rubberbandModule: any = null;
    private tempInputBuffer: Float32Array;
    private tempOutputBuffer: Float32Array;
    private config: ProcessorConfig = {
        useHighQuality: false,
        preserveFormants: true,
        channels: 1
    };

    constructor() {
        super();
        this.tempInputBuffer = new Float32Array(4096);
        this.tempOutputBuffer = new Float32Array(4096);
        this.port.onmessage = this.handleMessage.bind(this);
    }

    /**
     * Build optimal stretcher options for vocal processing.
     * Combines options based on configuration and use case.
     */
    private buildVocalOptions(module: any): number {
        let options = 0;

        // Real-time processing with lookahead for lower latency
        options |= module.RubberBandStretcher.OptionProcessRealTime;

        // Precise stretching for accurate timing
        options |= module.RubberBandStretcher.OptionStretchPrecise;

        // CRITICAL: Preserve formants to avoid "chipmunk" effect on vocals
        if (this.config.preserveFormants) {
            options |= module.RubberBandStretcher.OptionFormantPreserved;
        }

        // Pitch-coherent mode for monophonic voice (laminar phase)
        options |= module.RubberBandStretcher.OptionPhaseLaminar;

        // Mixed transients: preserve consonants like 't', 'k' while smoothing vowels
        options |= module.RubberBandStretcher.OptionTransientsMixed;

        // Use higher quality pitch shifting for better vocal fidelity
        options |= module.RubberBandStretcher.OptionPitchHighQuality;

        // Use Finer engine for offline/high-quality rendering
        if (this.config.useHighQuality) {
            options |= module.RubberBandStretcher.OptionEngineFiner;
        } else {
            // Use Faster engine for real-time preview (lower CPU)
            options |= module.RubberBandStretcher.OptionEngineFaster;
        }

        return options;
    }

    private handleMessage(event: MessageEvent) {
        const { type, data } = event.data;
        if (type === 'init') {
            this.inputRingBuffer = new RingBuffer(data.inputSab);
            this.outputRingBuffer = new RingBuffer(data.outputSab);
            
            // Apply configuration from init data
            if (data.config) {
                this.config = { ...this.config, ...data.config };
            }

            importScripts('/rubberband.js');
            globalThis.createRubberbandModule().then(module => {
                this.rubberbandModule = module;
                const stretcherOptions = this.buildVocalOptions(module);

                this.rubberband = new module.RubberBandStretcher(
                    sampleRate,
                    this.config.channels,
                    stretcherOptions,
                    1.0, // initial time ratio
                    1.0 // initial pitch ratio
                );
                
                // Report latency for synchronization (Section 9 of enhancement plan)
                const latency = this.rubberband.getLatency();
                this.port.postMessage({ 
                    type: 'ready',
                    latency: latency,
                    sampleRate: sampleRate
                });
            });
        } else if (type === 'pitch') {
            if (this.rubberband) {
                this.rubberband.setPitchScale(data.pitchScale);
            }
        } else if (type === 'timeRatio') {
            if (this.rubberband) {
                this.rubberband.setTimeRatio(data.timeRatio);
            }
        } else if (type === 'setFormantPreservation') {
            // Dynamic formant option switching (Section 4 of enhancement plan)
            if (this.rubberband) {
                // 1 = preserved, 0 = shifted
                this.rubberband.setFormantOption(data.preserve ? 1 : 0);
                this.config.preserveFormants = data.preserve;
            }
        } else if (type === 'setQuality') {
            // Toggle between high quality (Finer) and fast (Faster) engines
            // Note: Engine switch requires re-initialization of the stretcher
            // The config is NOT updated here since it would create inconsistent state
            // Clients should recreate the processor with new config for quality changes
            console.warn('Quality mode change requires processor reinitialization. ' +
                         'Recreate SingingVoice with new config for quality changes.');
        } else if (type === 'getLatency') {
            // Return current latency for synchronization purposes
            if (this.rubberband) {
                const latency = this.rubberband.getLatency();
                this.port.postMessage({ type: 'latency', latency: latency });
            }
        }
    }

    process(
        inputs: Float32Array[][],
        outputs: Float32Array[][],
    ): boolean {
        const output = outputs[0];
        const channel = output[0];

        if (!this.inputRingBuffer || !this.outputRingBuffer || !this.rubberband) {
            channel.fill(0);
            return true;
        }

        const availableToRead = this.inputRingBuffer.pull(this.tempInputBuffer);
        if (availableToRead > 0) {
            const planarInput = [this.tempInputBuffer.subarray(0, availableToRead)];
            this.rubberband.process(planarInput, availableToRead, false);
        }

        const availableSamples = this.rubberband.available();
        if (availableSamples > 0) {
            const retrieved = this.rubberband.retrieve([this.tempOutputBuffer], availableSamples);
            this.outputRingBuffer.push(this.tempOutputBuffer.subarray(0, retrieved));
        }

        const readFromOutput = this.outputRingBuffer.pull(channel);
        if (readFromOutput < channel.length) {
            channel.fill(0, readFromOutput);
        }

        return true;
    }
}

registerProcessor('rubberband-processor', RubberbandProcessor);
