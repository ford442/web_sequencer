import { describe, it, expect, beforeEach, vi, beforeAll } from 'vitest';
import {
    HybridNeuralPipeline,
    createPipeline,
    processTTS,
    DEFAULT_MEL_CONFIG,
    type HybridPipelineConfig,
    type PipelineCallbacks,
    type MelSpectrogram
} from '../HybridNeuralPipeline';

// Mock onnxruntime-web
vi.mock('onnxruntime-web', () => ({
    env: {
        wasm: {
            wasmPaths: '',
            numThreads: 2
        }
    },
    Tensor: class MockTensor {
        type: string;
        data: Float32Array;
        dims: number[];

        constructor(type: string, data: Float32Array, dims: number[]) {
            this.type = type;
            this.data = data;
            this.dims = dims;
        }
    },
    InferenceSession: {
        create: vi.fn().mockResolvedValue({
            inputNames: ['input'],
            outputNames: ['output'],
            run: vi.fn().mockResolvedValue({
                output: {
                    data: new Float32Array(1000).fill(0.5)
                }
            }),
            release: vi.fn()
        })
    }
}));

describe('HybridNeuralPipeline', () => {
    let pipeline: HybridNeuralPipeline;

    beforeEach(() => {
        pipeline = new HybridNeuralPipeline({
            useGpu: false,
            maxSessions: 1
        });
    });

    describe('Initialization', () => {
        it('should create a pipeline with default config', () => {
            const defaultPipeline = new HybridNeuralPipeline();
            expect(defaultPipeline).toBeDefined();
            expect(defaultPipeline.isReady()).toBe(false);
        });

        it('should create a pipeline with custom config', () => {
            const customPipeline = new HybridNeuralPipeline({
                melConfig: {
                    nMels: 128,
                    nFft: 2048,
                    hopLength: 512,
                    sampleRate: 44100,
                    fMin: 20,
                    fMax: 11025
                },
                useGpu: true,
                maxSessions: 4
            });
            expect(customPipeline).toBeDefined();
        });

        it('should initialize successfully', async () => {
            await pipeline.init();
            expect(pipeline.isReady()).toBe(true);
        });

        it('should not reinitialize if already initialized', async () => {
            await pipeline.init();
            const firstReady = pipeline.isReady();
            await pipeline.init();
            expect(pipeline.isReady()).toBe(firstReady);
        });

        it('should return correct execution provider', async () => {
            await pipeline.init();
            const provider = pipeline.getExecutionProvider();
            expect(['webgpu', 'webgl', 'wasm']).toContain(provider);
        });
    });

    describe('Mel Spectrogram Computation', () => {
        beforeEach(async () => {
            await pipeline.init();
        });

        it('should convert audio to mel spectrogram', () => {
            const sampleRate = 22050;
            const duration = 1; // 1 second
            const audio = new Float32Array(sampleRate * duration);

            // Create a simple sine wave
            for (let i = 0; i < audio.length; i++) {
                audio[i] = Math.sin(2 * Math.PI * 440 * i / sampleRate);
            }

            const mel = pipeline.audioToMel(audio);

            expect(mel).toBeDefined();
            expect(mel.nMels).toBe(DEFAULT_MEL_CONFIG.nMels);
            expect(mel.nFrames).toBeGreaterThan(0);
            expect(mel.sampleRate).toBe(sampleRate);
            expect(mel.data.length).toBe(mel.nMels * mel.nFrames);
        });

        it('should handle silence correctly', () => {
            const audio = new Float32Array(22050).fill(0);
            const mel = pipeline.audioToMel(audio);

            expect(mel).toBeDefined();
            expect(mel.nFrames).toBeGreaterThan(0);

            // All values should be at minimum dB
            for (let i = 0; i < mel.data.length; i++) {
                expect(mel.data[i]).toBeLessThanOrEqual(0);
            }
        });

        it('should handle different audio lengths', () => {
            const lengths = [0.1, 0.5, 1.0, 2.0]; // seconds
            const sampleRate = 22050;

            for (const length of lengths) {
                const audio = new Float32Array(Math.floor(sampleRate * length));
                audio.fill(Math.random() * 0.5);

                const mel = pipeline.audioToMel(audio);
                expect(mel.nFrames).toBeGreaterThan(0);
            }
        });

        it('should produce consistent output for same input', () => {
            const audio = new Float32Array(22050);
            for (let i = 0; i < audio.length; i++) {
                audio[i] = Math.sin(2 * Math.PI * 440 * i / 22050);
            }

            const mel1 = pipeline.audioToMel(audio);
            const mel2 = pipeline.audioToMel(audio);

            expect(mel1.nFrames).toBe(mel2.nFrames);
            expect(mel1.data.length).toBe(mel2.data.length);

            for (let i = 0; i < mel1.data.length; i++) {
                expect(mel1.data[i]).toBeCloseTo(mel2.data[i], 5);
            }
        });
    });

    describe('Pitch Shifting', () => {
        beforeEach(async () => {
            await pipeline.init();
        });

        it('should pitch shift up correctly', () => {
            const mel = createMockMelSpectrogram();
            const shifted = pipeline.pitchShiftMel(mel, 12); // Octave up

            expect(shifted).toBeDefined();
            expect(shifted.nMels).toBe(mel.nMels);
            expect(shifted.nFrames).toBe(mel.nFrames);
        });

        it('should pitch shift down correctly', () => {
            const mel = createMockMelSpectrogram();
            const shifted = pipeline.pitchShiftMel(mel, -12); // Octave down

            expect(shifted).toBeDefined();
            expect(shifted.nMels).toBe(mel.nMels);
            expect(shifted.nFrames).toBe(mel.nFrames);
        });

        it('should return same mel for zero shift', () => {
            const mel = createMockMelSpectrogram();
            const shifted = pipeline.pitchShiftMel(mel, 0);

            expect(shifted.nFrames).toBe(mel.nFrames);
            expect(shifted.data.length).toBe(mel.data.length);
        });

        it('should handle very small shifts', () => {
            const mel = createMockMelSpectrogram();
            const shifted = pipeline.pitchShiftMel(mel, 0.001);

            expect(shifted).toBeDefined();
            expect(shifted.nMels).toBe(mel.nMels);
        });

        it('should preserve mel dimensions through shift', () => {
            const mel = createMockMelSpectrogram();
            const shifts = [-24, -12, -5, 0, 5, 12, 24];

            for (const shift of shifts) {
                const shifted = pipeline.pitchShiftMel(mel, shift);
                expect(shifted.nMels).toBe(mel.nMels);
                expect(shifted.nFrames).toBe(mel.nFrames);
            }
        });
    });

    describe('Vocoder Synthesis', () => {
        beforeEach(async () => {
            await pipeline.init();
        });

        it('should synthesize audio from mel spectrogram', async () => {
            const mel = createMockMelSpectrogram();
            const audio = await pipeline.melToAudio(mel);

            expect(audio).toBeDefined();
            expect(audio.length).toBeGreaterThan(0);
            expect(audio instanceof Float32Array).toBe(true);
        });

        it('should produce normalized output', async () => {
            const mel = createMockMelSpectrogram();
            const audio = await pipeline.melToAudio(mel);

            let maxAmp = 0;
            for (let i = 0; i < audio.length; i++) {
                maxAmp = Math.max(maxAmp, Math.abs(audio[i]));
            }

            expect(maxAmp).toBeLessThanOrEqual(1.0);
        });
    });

    describe('Full Pipeline', () => {
        beforeEach(async () => {
            await pipeline.init();
        });

        it('should process TTS through full pipeline', async () => {
            const sampleRate = 22050;
            const audio = new Float32Array(sampleRate);
            for (let i = 0; i < audio.length; i++) {
                audio[i] = Math.sin(2 * Math.PI * 440 * i / sampleRate) * 0.5;
            }

            const result = await pipeline.synthesize(audio, 12, 1.0);

            expect(result).toBeDefined();
            expect(result instanceof Float32Array).toBe(true);
            expect(result.length).toBeGreaterThan(0);
        });

        it('should handle different pitch shifts', async () => {
            const audio = new Float32Array(22050).fill(0.5);
            const shifts = [-12, -5, 0, 5, 12];

            for (const shift of shifts) {
                const result = await pipeline.synthesize(audio, shift, 1.0);
                expect(result).toBeDefined();
                expect(result.length).toBeGreaterThan(0);
            }
        });

        it('should auto-initialize if not already initialized', async () => {
            const freshPipeline = new HybridNeuralPipeline({ useGpu: false });
            const audio = new Float32Array(22050).fill(0.5);

            const result = await freshPipeline.synthesize(audio, 0, 1.0);
            expect(result).toBeDefined();
            expect(freshPipeline.isReady()).toBe(true);
        });
    });

    describe('Callbacks', () => {
        beforeEach(async () => {
            await pipeline.init();
        });

        it('should call all callbacks during synthesis', async () => {
            const callbacks: PipelineCallbacks = {
                onMelStart: vi.fn(),
                onMelComplete: vi.fn(),
                onPitchShiftStart: vi.fn(),
                onPitchShiftComplete: vi.fn(),
                onVocoderStart: vi.fn(),
                onVocoderComplete: vi.fn(),
                onMetrics: vi.fn()
            };

            pipeline.setCallbacks(callbacks);

            const audio = new Float32Array(22050).fill(0.5);
            await pipeline.synthesize(audio, 12, 1.0);

            expect(callbacks.onMelStart).toHaveBeenCalled();
            expect(callbacks.onMelComplete).toHaveBeenCalled();
            expect(callbacks.onPitchShiftStart).toHaveBeenCalled();
            expect(callbacks.onPitchShiftComplete).toHaveBeenCalled();
            expect(callbacks.onVocoderStart).toHaveBeenCalled();
            expect(callbacks.onVocoderComplete).toHaveBeenCalled();
            expect(callbacks.onMetrics).toHaveBeenCalled();
        });

        it('should pass correct data to callbacks', async () => {
            let capturedMel: MelSpectrogram | undefined;
            let capturedMetrics: { totalTime: number } | undefined;

            const callbacks: PipelineCallbacks = {
                onMelComplete: (mel) => { capturedMel = mel; },
                onMetrics: (metrics) => { capturedMetrics = metrics; }
            };

            pipeline.setCallbacks(callbacks);

            const audio = new Float32Array(22050).fill(0.5);
            await pipeline.synthesize(audio, 0, 1.0);

            expect(capturedMel).toBeDefined();
            expect(capturedMel!.nMels).toBe(DEFAULT_MEL_CONFIG.nMels);
            expect(capturedMetrics).toBeDefined();
            expect(capturedMetrics!.totalTime).toBeGreaterThan(0);
        });

        it('should call error callback on initialization failure', async () => {
            const errorCallback = vi.fn();

            // Create a pipeline that will fail to initialize
            const failingPipeline = new HybridNeuralPipeline({
                useGpu: false,
                maxSessions: 1
            });

            failingPipeline.setCallbacks({ onError: errorCallback });

            // Mock the session creation to throw an error
            const { InferenceSession } = await import('onnxruntime-web');
            const originalCreate = InferenceSession.create;
            (InferenceSession as any).create = vi.fn().mockRejectedValue(new Error('Failed to load model'));

            try {
                await failingPipeline.init();
            } catch {
                // Expected to throw
            }

            expect(errorCallback).toHaveBeenCalled();

            // Restore original
            (InferenceSession as any).create = originalCreate;
        });
    });

    describe('State Management', () => {
        it('should return current state', async () => {
            await pipeline.init();

            const audio = new Float32Array(22050).fill(0.5);
            await pipeline.synthesize(audio, 12, 1.5);

            const state = pipeline.getState();
            expect(state.inputBuffer).toBeDefined();
            expect(state.pitchShift).toBe(12);
            expect(state.timeRatio).toBe(1.5);
        });

        it('should return initial state before processing', () => {
            const state = pipeline.getState();
            expect(state.inputBuffer).toBeNull();
            expect(state.melSpectrogram).toBeNull();
            expect(state.pitchShift).toBe(0);
            expect(state.timeRatio).toBe(1.0);
        });
    });

    describe('Utility Functions', () => {
        it('createPipeline should create a pipeline instance', () => {
            const p = createPipeline({ useGpu: false });
            expect(p).toBeInstanceOf(HybridNeuralPipeline);
        });

        it('processTTS should process audio and dispose pipeline', async () => {
            const audio = new Float32Array(22050).fill(0.5);
            const result = await processTTS(audio, 12, { useGpu: false, maxSessions: 1 });

            expect(result).toBeDefined();
            expect(result instanceof Float32Array).toBe(true);
        });
    });

    describe('Configuration', () => {
        it('should use default mel config when not specified', () => {
            const p = new HybridNeuralPipeline({});
            expect(p).toBeDefined();
        });

        it('should accept custom execution providers', () => {
            const p = new HybridNeuralPipeline({
                executionProviders: ['wasm'],
                useGpu: false
            });
            expect(p).toBeDefined();
        });
    });

    describe('Resource Management', () => {
        it('should dispose resources correctly', async () => {
            await pipeline.init();
            expect(pipeline.isReady()).toBe(true);

            pipeline.dispose();
            expect(pipeline.isReady()).toBe(false);
        });

        it('should handle disposal of uninitialized pipeline', () => {
            const freshPipeline = new HybridNeuralPipeline();
            expect(() => freshPipeline.dispose()).not.toThrow();
        });
    });

    describe('Edge Cases', () => {
        beforeEach(async () => {
            await pipeline.init();
        });

        it('should handle very short audio', async () => {
            const audio = new Float32Array(100).fill(0.5);
            const result = await pipeline.synthesize(audio, 0, 1.0);
            expect(result).toBeDefined();
        });

        it('should handle empty audio', async () => {
            const audio = new Float32Array(0);
            const result = await pipeline.synthesize(audio, 0, 1.0);
            expect(result).toBeDefined();
        });

        it('should handle audio with extreme values', async () => {
            const audio = new Float32Array(22050);
            for (let i = 0; i < audio.length; i++) {
                audio[i] = i % 2 === 0 ? 1.0 : -1.0;
            }

            const result = await pipeline.synthesize(audio, 0, 1.0);
            expect(result).toBeDefined();
        });

        it('should handle large pitch shifts', async () => {
            const audio = new Float32Array(22050).fill(0.5);
            const result = await pipeline.synthesize(audio, 24, 1.0);
            expect(result).toBeDefined();
        });

        it('should handle negative pitch shifts', async () => {
            const audio = new Float32Array(22050).fill(0.5);
            const result = await pipeline.synthesize(audio, -24, 1.0);
            expect(result).toBeDefined();
        });
    });
});

// Helper function to create mock mel spectrogram
function createMockMelSpectrogram(): MelSpectrogram {
    const nMels = 80;
    const nFrames = 100;
    const data = new Float32Array(nMels * nFrames);

    // Fill with some realistic dB values
    for (let i = 0; i < data.length; i++) {
        data[i] = -50 + Math.random() * 50; // -50 to 0 dB
    }

    return {
        data,
        nMels,
        nFrames,
        sampleRate: 22050
    };
}
