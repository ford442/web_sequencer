/**
 * HybridNeuralPipeline - Combined neural + DSP approach for ultimate quality
 *
 * Part of RUBBERBAND_ENHANCEMENT_PLAN Section 6: Hybrid Neural + Rubber Band Approach
 *
 * Combines the best of both worlds:
 * - Neural vocoding for high-quality audio synthesis
 * - Rubber Band for precise time stretching
 * - Mel-spectrogram manipulation for artifact-free pitch shifting
 *
 * Architecture:
 * 1. Generate mel-spectrogram from TTS
 * 2. Pitch-shift the spectrogram directly (avoids phase issues)
 * 3. Use Rubber Band for time-stretching only (where it excels)
 * 4. Synthesize with neural vocoder (ONNX Runtime Web with HiFi-GAN)
 *
 * @see RUBBERBAND_ENHANCEMENT_PLAN.md Section 6
 */

import * as ort from 'onnxruntime-web';

/** Mel-spectrogram configuration */
export interface MelConfig {
    /** Number of mel filter banks */
    nMels: number;
    /** FFT window size */
    nFft: number;
    /** Hop length between frames */
    hopLength: number;
    /** Sample rate */
    sampleRate: number;
    /** Minimum frequency for mel scale */
    fMin: number;
    /** Maximum frequency for mel scale */
    fMax: number;
}

/** Default mel configuration matching typical TTS models */
export const DEFAULT_MEL_CONFIG: MelConfig = {
    nMels: 80,
    nFft: 1024,
    hopLength: 256,
    sampleRate: 22050,
    fMin: 0,
    fMax: 8000
};

/** Result from mel-spectrogram computation */
export interface MelSpectrogram {
    /** Mel spectrogram data [n_mels, n_frames] in dB scale */
    data: Float32Array;
    /** Number of mel bins */
    nMels: number;
    /** Number of time frames */
    nFrames: number;
    /** Sample rate of original audio */
    sampleRate: number;
}

/** Configuration for the hybrid pipeline */
export interface HybridPipelineConfig {
    /** Mel spectrogram configuration */
    melConfig?: MelConfig;
    /** URL to ONNX vocoder model (HiFi-GAN) */
    vocoderModelUrl?: string;
    /** Use GPU acceleration if available (WebGPU > WebGL > WASM) */
    useGpu?: boolean;
    /** Execution provider preference order */
    executionProviders?: string[];
    /** ONNX Runtime Web WASM path */
    wasmPath?: string;
    /** Maximum concurrent inference sessions */
    maxSessions?: number;
}

/** Vocoder inference session wrapper */
interface VocoderSession {
    session: ort.InferenceSession;
    inUse: boolean;
}

/** FFT window function type */
type WindowFunction = 'hann' | 'hamming' | 'blackman';

/** Pipeline processing state */
interface PipelineState {
    /** Current input audio buffer */
    inputBuffer: Float32Array | null;
    /** Current mel spectrogram */
    melSpectrogram: MelSpectrogram | null;
    /** Current pitch shift in semitones */
    pitchShift: number;
    /** Current time stretch ratio */
    timeRatio: number;
}

/** Performance metrics for monitoring */
export interface PipelineMetrics {
    /** Time spent on mel conversion (ms) */
    melConversionTime: number;
    /** Time spent on pitch shifting (ms) */
    pitchShiftTime: number;
    /** Time spent on vocoder inference (ms) */
    vocoderTime: number;
    /** Total pipeline time (ms) */
    totalTime: number;
    /** Current execution provider being used */
    executionProvider: string;
}

/** Event callbacks for pipeline progress */
export interface PipelineCallbacks {
    /** Called when mel conversion starts */
    onMelStart?: () => void;
    /** Called when mel conversion completes */
    onMelComplete?: (mel: MelSpectrogram) => void;
    /** Called when pitch shifting starts */
    onPitchShiftStart?: (semitones: number) => void;
    /** Called when pitch shifting completes */
    onPitchShiftComplete?: (mel: MelSpectrogram) => void;
    /** Called when vocoder inference starts */
    onVocoderStart?: () => void;
    /** Called when vocoder inference completes */
    onVocoderComplete?: (audio: Float32Array) => void;
    /** Called when metrics are available */
    onMetrics?: (metrics: PipelineMetrics) => void;
    /** Called on error */
    onError?: (error: Error, stage: string) => void;
}

/**
 * HybridNeuralPipeline class for high-quality vocal synthesis.
 *
 * Full implementation with:
 * 1. HiFi-GAN neural vocoder via ONNX Runtime Web
 * 2. Efficient mel-spectrogram computation
 * 3. Spectrogram pitch shifting algorithm
 * 4. WebGPU acceleration with WASM fallback
 * 5. Session pooling for concurrent processing
 */
export class HybridNeuralPipeline {
    private config: Required<HybridPipelineConfig>;
    private isInitialized = false;
    private vocoderSessions: VocoderSession[] = [];
    private fftLookup: Map<number, { real: Float32Array; imag: Float32Array }> = new Map();
    private melFilterbank: Float32Array | null = null;
    private state: PipelineState = {
        inputBuffer: null,
        melSpectrogram: null,
        pitchShift: 0,
        timeRatio: 1.0
    };
    private callbacks: PipelineCallbacks = {};

    // Pre-allocated buffers to avoid GC in hot paths
    private preAllocatedBuffers: {
        fftReal: Float32Array | null;
        fftImag: Float32Array | null;
        melBuffer: Float32Array | null;
        window: Float32Array | null;
    } = {
        fftReal: null,
        fftImag: null,
        melBuffer: null,
        window: null
    };

    constructor(config: HybridPipelineConfig = {}) {
        this.config = {
            melConfig: config.melConfig ?? DEFAULT_MEL_CONFIG,
            vocoderModelUrl: config.vocoderModelUrl ?? '/models/hifigan.onnx',
            useGpu: config.useGpu ?? true,
            executionProviders: config.executionProviders ?? ['webgpu', 'webgl', 'wasm'],
            wasmPath: config.wasmPath ?? '/onnx-runtime/',
            maxSessions: config.maxSessions ?? 2
        };
    }

    /**
     * Set event callbacks for pipeline progress monitoring
     */
    setCallbacks(callbacks: PipelineCallbacks): void {
        this.callbacks = { ...this.callbacks, ...callbacks };
    }

    /**
     * Initialize the hybrid pipeline.
     * Loads ONNX Runtime and creates vocoder inference sessions.
     */
    async init(): Promise<void> {
        if (this.isInitialized) return;

        try {
            // Configure ONNX Runtime
            ort.env.wasm.wasmPaths = this.config.wasmPath;
            ort.env.wasm.numThreads = navigator.hardwareConcurrency > 4 ? 4 : 2;

            // Pre-compute mel filterbank
            this.melFilterbank = this.computeMelFilterbank();

            // Pre-allocate buffers based on max expected size
            const maxFftSize = this.config.melConfig.nFft;
            this.preAllocatedBuffers.fftReal = new Float32Array(maxFftSize);
            this.preAllocatedBuffers.fftImag = new Float32Array(maxFftSize);
            this.preAllocatedBuffers.melBuffer = new Float32Array(
                this.config.melConfig.nMels * 1000 // Max 1000 frames
            );
            this.preAllocatedBuffers.window = this.createWindow(
                maxFftSize,
                'hann'
            );

            // Initialize vocoder sessions (pool for concurrent processing)
            await this.initializeVocoderSessions();

            this.isInitialized = true;
        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            this.callbacks.onError?.(err, 'initialization');
            throw err;
        }
    }

    /**
     * Initialize vocoder inference session pool
     */
    private async initializeVocoderSessions(): Promise<void> {
        const sessionOptions: ort.InferenceSession.SessionOptions = {
            executionProviders: this.getExecutionProviders(),
            graphOptimizationLevel: 'all',
            enableCpuMemArena: true,
            enableMemPattern: true
        };

        // Create session pool
        for (let i = 0; i < this.config.maxSessions; i++) {
            try {
                const session = await ort.InferenceSession.create(
                    this.config.vocoderModelUrl,
                    sessionOptions
                );
                this.vocoderSessions.push({ session, inUse: false });
            } catch (error) {
                if (i === 0) {
                    // First session failed - critical error
                    throw error;
                }
                // Subsequent failures just reduce pool size
                break;
            }
        }

        if (this.vocoderSessions.length === 0) {
            throw new Error('Failed to initialize any vocoder sessions');
        }
    }

    /**
     * Get available execution providers in priority order
     */
    private getExecutionProviders(): string[] {
        const providers: string[] = [];

        for (const provider of this.config.executionProviders) {
            if (provider === 'webgpu' && this.isWebGpuAvailable()) {
                providers.push('webgpu');
            } else if (provider === 'webgl' && this.isWebGlAvailable()) {
                providers.push('webgl');
            } else if (provider === 'wasm') {
                providers.push('wasm');
            }
        }

        // Fallback to wasm if nothing else available
        if (providers.length === 0) {
            providers.push('wasm');
        }

        return providers;
    }

    /**
     * Check if WebGPU is available
     */
    private isWebGpuAvailable(): boolean {
        return typeof navigator !== 'undefined' &&
               'gpu' in navigator &&
               this.config.useGpu;
    }

    /**
     * Check if WebGL is available
     */
    private isWebGlAvailable(): boolean {
        if (typeof document === 'undefined') return false;

        try {
            const canvas = document.createElement('canvas');
            const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
            return gl !== null && this.config.useGpu;
        } catch {
            return false;
        }
    }

    /**
     * Acquire a vocoder session from the pool
     */
    private acquireSession(): VocoderSession | null {
        for (const session of this.vocoderSessions) {
            if (!session.inUse) {
                session.inUse = true;
                return session;
            }
        }
        return null;
    }

    /**
     * Release a vocoder session back to the pool
     */
    private releaseSession(session: VocoderSession): void {
        session.inUse = false;
    }

    /**
     * Convert audio to mel spectrogram using STFT and mel filterbank
     *
     * @param audio Float32Array of audio samples
     * @returns Mel spectrogram
     */
    audioToMel(audio: Float32Array): MelSpectrogram {
        const startTime = performance.now();
        this.callbacks.onMelStart?.();

        const config = this.config.melConfig;
        const nFrames = Math.ceil(audio.length / config.hopLength);

        // Allocate output buffer
        const melData = new Float32Array(config.nMels * nFrames);

        // Process each frame
        for (let frame = 0; frame < nFrames; frame++) {
            const startSample = frame * config.hopLength;
            const frameData = this.extractFrame(audio, startSample, config.nFft);

            // Apply window function
            this.applyWindow(frameData, this.preAllocatedBuffers.window!);

            // Compute FFT
            const spectrum = this.fftMagnitude(frameData);

            // Apply mel filterbank
            const melFrame = this.applyMelFilterbank(spectrum);

            // Convert to dB scale and store
            for (let i = 0; i < config.nMels; i++) {
                const db = this.amplitudeToDb(melFrame[i]);
                melData[frame * config.nMels + i] = db;
            }
        }

        const mel: MelSpectrogram = {
            data: melData,
            nMels: config.nMels,
            nFrames,
            sampleRate: config.sampleRate
        };

        this.state.melSpectrogram = mel;
        const melTime = performance.now() - startTime;

        this.callbacks.onMelComplete?.(mel);

        return mel;
    }

    /**
     * Extract a frame from audio with zero-padding
     */
    private extractFrame(audio: Float32Array, start: number, length: number): Float32Array {
        const frame = new Float32Array(length);
        for (let i = 0; i < length; i++) {
            const idx = start + i;
            frame[i] = idx < audio.length ? audio[idx] : 0;
        }
        return frame;
    }

    /**
     * Apply window function to frame
     */
    private applyWindow(frame: Float32Array, window: Float32Array): void {
        for (let i = 0; i < frame.length && i < window.length; i++) {
            frame[i] *= window[i];
        }
    }

    /**
     * Create window function
     */
    private createWindow(size: number, type: WindowFunction): Float32Array {
        const window = new Float32Array(size);
        for (let i = 0; i < size; i++) {
            if (type === 'hann') {
                window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1));
            } else if (type === 'hamming') {
                window[i] = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (size - 1));
            } else if (type === 'blackman') {
                window[i] = 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1)) +
                           0.08 * Math.cos((4 * Math.PI * i) / (size - 1));
            }
        }
        return window;
    }

    /**
     * Compute FFT magnitude spectrum
     */
    private fftMagnitude(frame: Float32Array): Float32Array {
        const n = frame.length;
        const nBins = n / 2 + 1;
        const magnitude = new Float32Array(nBins);

        // Use iterative Cooley-Tukey FFT for small sizes
        if (n <= 1024) {
            this.iterativeFFT(frame, magnitude);
        } else {
            // For larger FFTs, use a simple DFT (slower but no dependencies)
            this.simpleDFT(frame, magnitude);
        }

        return magnitude;
    }

    /**
     * Iterative FFT implementation for power-of-2 sizes
     */
    private iterativeFFT(input: Float32Array, output: Float32Array): void {
        const n = input.length;
        const real = this.preAllocatedBuffers.fftReal!;
        const imag = this.preAllocatedBuffers.fftImag!;

        // Copy input
        real.set(input);
        imag.fill(0);

        // Bit reversal permutation
        let j = 0;
        for (let i = 0; i < n; i++) {
            if (i < j) {
                [real[i], real[j]] = [real[j], real[i]];
            }
            let k = n >> 1;
            while (k > 0 && j >= k) {
                j -= k;
                k >>= 1;
            }
            j += k;
        }

        // Cooley-Tukey iterations
        for (let len = 2; len <= n; len <<= 1) {
            const halfLen = len >> 1;
            const angle = -2 * Math.PI / len;

            for (let i = 0; i < n; i += len) {
                for (let k = 0; k < halfLen; k++) {
                    const uReal = real[i + k];
                    const uImag = imag[i + k];
                    const angleK = angle * k;
                    const vReal = real[i + k + halfLen] * Math.cos(angleK) -
                                  imag[i + k + halfLen] * Math.sin(angleK);
                    const vImag = real[i + k + halfLen] * Math.sin(angleK) +
                                  imag[i + k + halfLen] * Math.cos(angleK);

                    real[i + k] = uReal + vReal;
                    imag[i + k] = uImag + vImag;
                    real[i + k + halfLen] = uReal - vReal;
                    imag[i + k + halfLen] = uImag - vImag;
                }
            }
        }

        // Compute magnitude (only positive frequencies)
        const nBins = n / 2 + 1;
        for (let i = 0; i < nBins; i++) {
            output[i] = Math.sqrt(real[i] * real[i] + imag[i] * imag[i]);
        }
    }

    /**
     * Simple DFT for non-power-of-2 sizes (slower fallback)
     */
    private simpleDFT(input: Float32Array, output: Float32Array): void {
        const n = input.length;
        const nBins = n / 2 + 1;

        for (let k = 0; k < nBins; k++) {
            let real = 0;
            let imag = 0;
            for (let t = 0; t < n; t++) {
                const angle = (2 * Math.PI * k * t) / n;
                real += input[t] * Math.cos(angle);
                imag -= input[t] * Math.sin(angle);
            }
            output[k] = Math.sqrt(real * real + imag * imag);
        }
    }

    /**
     * Compute mel filterbank matrix
     */
    private computeMelFilterbank(): Float32Array {
        const config = this.config.melConfig;
        const nBins = config.nFft / 2 + 1;
        const filterbank = new Float32Array(config.nMels * nBins);

        // Convert Hz to mel
        const hzToMel = (hz: number): number => 2595 * Math.log10(1 + hz / 700);
        const melToHz = (mel: number): number => 700 * (Math.pow(10, mel / 2595) - 1);

        const melMin = hzToMel(config.fMin);
        const melMax = hzToMel(config.fMax);

        // Create mel frequency points
        const melPoints: number[] = [];
        for (let i = 0; i < config.nMels + 2; i++) {
            melPoints.push(melMin + (i * (melMax - melMin)) / (config.nMels + 1));
        }

        // Convert to FFT bin indices
        const binPoints = melPoints.map(mel =>
            Math.floor((nBins * melToHz(mel)) / (config.sampleRate / 2))
        );

        // Create triangular filters
        for (let i = 0; i < config.nMels; i++) {
            const left = binPoints[i];
            const center = binPoints[i + 1];
            const right = binPoints[i + 2];

            for (let j = left; j < center; j++) {
                if (j < nBins) {
                    filterbank[i * nBins + j] = (j - left) / (center - left);
                }
            }
            for (let j = center; j < right; j++) {
                if (j < nBins) {
                    filterbank[i * nBins + j] = (right - j) / (right - center);
                }
            }
        }

        return filterbank;
    }

    /**
     * Apply mel filterbank to magnitude spectrum
     */
    private applyMelFilterbank(spectrum: Float32Array): Float32Array {
        const config = this.config.melConfig;
        const nBins = spectrum.length;
        const result = new Float32Array(config.nMels);

        for (let i = 0; i < config.nMels; i++) {
            let sum = 0;
            for (let j = 0; j < nBins; j++) {
                sum += spectrum[j] * this.melFilterbank![i * nBins + j];
            }
            result[i] = sum;
        }

        return result;
    }

    /**
     * Convert amplitude to dB scale
     */
    private amplitudeToDb(amplitude: number): number {
        const minDb = -100;
        const reference = 1.0;

        if (amplitude <= 0) return minDb;

        const db = 20 * Math.log10(amplitude / reference);
        return Math.max(db, minDb);
    }

    /**
     * Convert dB to amplitude
     */
    private dbToAmplitude(db: number): number {
        return Math.pow(10, db / 20);
    }

    /**
     * Pitch-shift a mel spectrogram by shifting frequency bins.
     * This avoids phase artifacts that occur with time-domain pitch shifting.
     *
     * @param mel Input mel spectrogram
     * @param semitones Pitch shift in semitones (positive = up, negative = down)
     * @returns Pitch-shifted mel spectrogram
     */
    pitchShiftMel(mel: MelSpectrogram, semitones: number): MelSpectrogram {
        const startTime = performance.now();
        this.callbacks.onPitchShiftStart?.(semitones);

        if (Math.abs(semitones) < 0.01) {
            // No significant shift needed
            this.callbacks.onPitchShiftComplete?.(mel);
            return mel;
        }

        // Calculate pitch shift ratio
        const ratio = Math.pow(2, semitones / 12);

        // Create output mel spectrogram
        const shiftedData = new Float32Array(mel.data.length);

        // For each frame, shift mel bins
        for (let frame = 0; frame < mel.nFrames; frame++) {
            const frameOffset = frame * mel.nMels;

            if (ratio > 1) {
                // Pitch up: interpolate from lower bins
                for (let i = 0; i < mel.nMels; i++) {
                    const sourceIdx = i / ratio;
                    const idx0 = Math.floor(sourceIdx);
                    const idx1 = Math.min(idx0 + 1, mel.nMels - 1);
                    const frac = sourceIdx - idx0;

                    if (idx0 < mel.nMels) {
                        const val0 = mel.data[frameOffset + idx0];
                        const val1 = mel.data[frameOffset + idx1];
                        // Interpolate in amplitude domain
                        const amp0 = this.dbToAmplitude(val0);
                        const amp1 = this.dbToAmplitude(val1);
                        const interpolatedAmp = amp0 * (1 - frac) + amp1 * frac;
                        shiftedData[frameOffset + i] = this.amplitudeToDb(interpolatedAmp);
                    } else {
                        shiftedData[frameOffset + i] = -100; // Silence
                    }
                }
            } else {
                // Pitch down: interpolate from higher bins
                for (let i = 0; i < mel.nMels; i++) {
                    const sourceIdx = i * ratio;
                    const idx0 = Math.floor(sourceIdx);
                    const idx1 = Math.min(idx0 + 1, mel.nMels - 1);
                    const frac = sourceIdx - idx0;

                    if (idx0 < mel.nMels) {
                        const val0 = mel.data[frameOffset + idx0];
                        const val1 = mel.data[frameOffset + idx1];
                        const amp0 = this.dbToAmplitude(val0);
                        const amp1 = this.dbToAmplitude(val1);
                        const interpolatedAmp = amp0 * (1 - frac) + amp1 * frac;
                        shiftedData[frameOffset + i] = this.amplitudeToDb(interpolatedAmp);
                    } else {
                        shiftedData[frameOffset + i] = -100;
                    }
                }
            }
        }

        const shiftedMel: MelSpectrogram = {
            data: shiftedData,
            nMels: mel.nMels,
            nFrames: mel.nFrames,
            sampleRate: mel.sampleRate
        };

        const shiftTime = performance.now() - startTime;
        this.callbacks.onPitchShiftComplete?.(shiftedMel);

        return shiftedMel;
    }

    /**
     * Synthesize audio from mel spectrogram using neural vocoder.
     *
     * @param mel Input mel spectrogram
     * @returns Synthesized audio
     */
    async melToAudio(mel: MelSpectrogram): Promise<Float32Array> {
        const startTime = performance.now();
        this.callbacks.onVocoderStart?.();

        const sessionWrapper = this.acquireSession();
        if (!sessionWrapper) {
            throw new Error('No vocoder sessions available');
        }

        try {
            // Prepare input tensor: [batch, nMels, nFrames]
            const batchSize = 1;
            const inputData = new Float32Array(batchSize * mel.nMels * mel.nFrames);

            // Transpose from [nFrames, nMels] to [nMels, nFrames]
            for (let i = 0; i < mel.nFrames; i++) {
                for (let j = 0; j < mel.nMels; j++) {
                    // Convert dB back to linear amplitude for vocoder
                    const db = mel.data[i * mel.nMels + j];
                    inputData[j * mel.nFrames + i] = this.dbToAmplitude(db);
                }
            }

            const inputTensor = new ort.Tensor('float32', inputData, [batchSize, mel.nMels, mel.nFrames]);

            // Run inference
            const feeds: Record<string, ort.Tensor> = {};
            const inputNames = sessionWrapper.session.inputNames;
            feeds[inputNames[0]] = inputTensor;

            const results = await sessionWrapper.session.run(feeds);

            // Extract output audio
            const outputName = sessionWrapper.session.outputNames[0];
            const outputTensor = results[outputName];
            const audio = new Float32Array(outputTensor.data as Float32Array);

            // Normalize output
            const maxAmp = Math.max(...Array.from(audio).map(Math.abs));
            if (maxAmp > 0) {
                for (let i = 0; i < audio.length; i++) {
                    audio[i] /= maxAmp;
                }
            }

            const vocoderTime = performance.now() - startTime;
            this.callbacks.onVocoderComplete?.(audio);

            return audio;
        } finally {
            this.releaseSession(sessionWrapper);
        }
    }

    /**
     * Full hybrid synthesis pipeline.
     *
     * Pipeline: TTS Audio → Mel Spectrogram → Pitch Shift → Vocoder → Output Audio
     *
     * @param ttsAudio Raw TTS audio
     * @param pitchSemitones Pitch shift in semitones
     * @param timeRatio Time stretch ratio (for Rubber Band integration)
     * @returns Processed audio
     */
    async synthesize(
        ttsAudio: Float32Array,
        pitchSemitones: number,
        timeRatio: number
    ): Promise<Float32Array> {
        const pipelineStart = performance.now();

        if (!this.isInitialized) {
            await this.init();
        }

        // Update state
        this.state.inputBuffer = ttsAudio;
        this.state.pitchShift = pitchSemitones;
        this.state.timeRatio = timeRatio;

        let mel: MelSpectrogram;
        let shiftedMel: MelSpectrogram;
        let audio: Float32Array;

        let melTime = 0;
        let pitchTime = 0;
        let vocoderTime = 0;

        try {
            // Step 1: Convert to mel spectrogram
            const melStart = performance.now();
            mel = this.audioToMel(ttsAudio);
            melTime = performance.now() - melStart;

            // Step 2: Pitch-shift the spectrogram
            const pitchStart = performance.now();
            shiftedMel = this.pitchShiftMel(mel, pitchSemitones);
            pitchTime = performance.now() - pitchStart;

            // Step 3: Synthesize with neural vocoder
            const vocoderStart = performance.now();
            audio = await this.melToAudio(shiftedMel);
            vocoderTime = performance.now() - vocoderStart;

        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            this.callbacks.onError?.(err, 'pipeline');
            throw err;
        }

        // Report metrics
        const totalTime = performance.now() - pipelineStart;
        const metrics: PipelineMetrics = {
            melConversionTime: melTime,
            pitchShiftTime: pitchTime,
            vocoderTime: vocoderTime,
            totalTime: totalTime,
            executionProvider: this.vocoderSessions[0]?.session ? 'unknown' : 'wasm'
        };

        this.callbacks.onMetrics?.(metrics);

        return audio;
    }

    /**
     * Get current execution provider being used
     */
    getExecutionProvider(): string {
        if (this.vocoderSessions.length > 0 && this.vocoderSessions[0].session) {
            // The actual provider isn't exposed directly, but we can infer from capabilities
            if (this.isWebGpuAvailable() && this.config.executionProviders.includes('webgpu')) {
                return 'webgpu';
            }
            if (this.isWebGlAvailable() && this.config.executionProviders.includes('webgl')) {
                return 'webgl';
            }
        }
        return 'wasm';
    }

    /**
     * Check if the pipeline is ready for use
     */
    isReady(): boolean {
        return this.isInitialized && this.vocoderSessions.length > 0;
    }

    /**
     * Get current pipeline state
     */
    getState(): Readonly<PipelineState> {
        return { ...this.state };
    }

    /**
     * Dispose of resources
     */
    dispose(): void {
        for (const session of this.vocoderSessions) {
            session.session.release();
        }
        this.vocoderSessions = [];
        this.isInitialized = false;
        this.melFilterbank = null;
        this.fftLookup.clear();
    }
}

/**
 * Create a HybridNeuralPipeline with default configuration
 */
export function createPipeline(config?: HybridPipelineConfig): HybridNeuralPipeline {
    return new HybridNeuralPipeline(config);
}

/**
 * Utility function to quickly process TTS audio through the pipeline
 */
export async function processTTS(
    ttsAudio: Float32Array,
    pitchSemitones: number,
    config?: HybridPipelineConfig
): Promise<Float32Array> {
    const pipeline = new HybridNeuralPipeline(config);
    await pipeline.init();
    const result = await pipeline.synthesize(ttsAudio, pitchSemitones, 1.0);
    pipeline.dispose();
    return result;
}

// Re-export types for convenience
export type { PipelineState, PipelineMetrics, PipelineCallbacks, VocoderSession };
