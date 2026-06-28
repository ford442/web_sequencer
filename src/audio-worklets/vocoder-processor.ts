/// <reference lib="dom" />
/// <reference types="vite/client" />

declare class AudioWorkletProcessor {
    readonly port: MessagePort;
    process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean;
}
declare function registerProcessor(name: string, processorCtor: new () => AudioWorkletProcessor): void;

// ---- Lightweight JS FFT Implementation ----
// Based on the Cooley-Tukey algorithm, in-place, allocation-free after init.
class SimpleFFT {
    private size: number;
    private bitReversedIndices: Uint32Array;
    private twiddleReal: Float32Array;
    private twiddleImag: Float32Array;

    constructor(size: number) {
        this.size = size;
        this.bitReversedIndices = new Uint32Array(size);
        this.twiddleReal = new Float32Array(size);
        this.twiddleImag = new Float32Array(size);

        // Precompute bit-reversed indices
        const bits = Math.log2(size);
        for (let i = 0; i < size; i++) {
            let reversed = 0;
            for (let j = 0; j < bits; j++) {
                reversed = (reversed << 1) | ((i >> j) & 1);
            }
            this.bitReversedIndices[i] = reversed;
        }

        // Precompute twiddle factors
        for (let k = 0; k < size; k++) {
            const angle = -2 * Math.PI * k / size;
            this.twiddleReal[k] = Math.cos(angle);
            this.twiddleImag[k] = Math.sin(angle);
        }
    }

    // Forward transform. input/output are interleaved complex arrays [re, im, re, im...]
    // For real input, put samples in re, 0 in im.
    forward(real: Float32Array, imag: Float32Array) {
        this.transform(real, imag, false);
    }

    inverse(real: Float32Array, imag: Float32Array) {
        this.transform(real, imag, true);
        for (let i = 0; i < this.size; i++) {
            real[i] /= this.size;
            imag[i] /= this.size;
        }
    }

    private transform(real: Float32Array, imag: Float32Array, inverse: boolean) {
        // Bit reversal permutation
        for (let i = 0; i < this.size; i++) {
            const j = this.bitReversedIndices[i];
            if (i < j) {
                const tempRe = real[i];
                const tempIm = imag[i];
                real[i] = real[j];
                imag[i] = imag[j];
                real[j] = tempRe;
                imag[j] = tempIm;
            }
        }

        // Cooley-Tukey butterfly
        for (let stage = 1; stage < this.size; stage <<= 1) {
            const step = stage << 1;
            const twiddleStep = this.size / step;

            for (let group = 0; group < stage; group++) {
                const twiddleIdx = group * twiddleStep;
                const wr = this.twiddleReal[twiddleIdx];
                // Conjugate twiddle factors for IFFT
                const wi = inverse ? -this.twiddleImag[twiddleIdx] : this.twiddleImag[twiddleIdx];

                for (let pair = group; pair < this.size; pair += step) {
                    const evenIdx = pair;
                    const oddIdx = pair + stage;

                    const evenRe = real[evenIdx];
                    const evenIm = imag[evenIdx];
                    const oddRe = real[oddIdx];
                    const oddIm = imag[oddIdx];

                    const twiddledOddRe = wr * oddRe - wi * oddIm;
                    const twiddledOddIm = wr * oddIm + wi * oddRe;

                    real[evenIdx] = evenRe + twiddledOddRe;
                    imag[evenIdx] = evenIm + twiddledOddIm;
                    real[oddIdx] = evenRe - twiddledOddRe;
                    imag[oddIdx] = evenIm - twiddledOddIm;
                }
            }
        }
    }
}

class VocoderProcessor extends AudioWorkletProcessor {
    static get parameterDescriptors() {
        return [
            {
                name: "mix",
                defaultValue: 0,
                minValue: 0,
                maxValue: 1,
                automationRate: "a-rate",
            }
        ];
    }

    private fftSize: number = 512;
    private hopSize: number = 128; // 4x overlap
    private fft: SimpleFFT;
    private window: Float32Array;

    // Circular buffers for input (1024 to be safe)
    private carrierBuffer: Float32Array;
    private modulatorBuffer: Float32Array;
    private outputBuffer: Float32Array;
    private inputWriteIdx: number = 0;
    private outputReadIdx: number = 0;
    private outputWriteIdx: number = 0;
    private samplesBuffered: number = 0;

    // Working arrays for FFT to avoid allocations
    private carrierRe: Float32Array;
    private carrierIm: Float32Array;
    private modulatorRe: Float32Array;
    private modulatorIm: Float32Array;
    private smoothedEnvelope: Float32Array;

    constructor() {
        super();
        this.fft = new SimpleFFT(this.fftSize);
        this.window = new Float32Array(this.fftSize);
        // Hann window
        for (let i = 0; i < this.fftSize; i++) {
            this.window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (this.fftSize - 1)));
        }

        const bufSize = this.fftSize * 4;
        this.carrierBuffer = new Float32Array(bufSize);
        this.modulatorBuffer = new Float32Array(bufSize);
        this.outputBuffer = new Float32Array(bufSize);

        this.carrierRe = new Float32Array(this.fftSize);
        this.carrierIm = new Float32Array(this.fftSize);
        this.modulatorRe = new Float32Array(this.fftSize);
        this.modulatorIm = new Float32Array(this.fftSize);
        this.smoothedEnvelope = new Float32Array(this.fftSize);

        // Delay the read pointer by fftSize to allow time for the OLA buffer to accumulate a full frame
        // before we start reading from it. This ensures causality in the ring buffer.
        this.outputReadIdx = (bufSize - this.fftSize) % bufSize;
    }

    process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>) {
        const carrierInput = inputs[0]?.[0]; // Synth A (mono downmix for vocoding)
        const modulatorInput = inputs[1]?.[0]; // TTS Sampler
        const outputChannelL = outputs[0]?.[0];
        const outputChannelR = outputs[0]?.[1];

        if (!carrierInput || !modulatorInput || !outputChannelL) {
            return true;
        }

        const mixParams = parameters.mix;
        const isMixConstant = mixParams.length === 1;
        const bufSize = this.carrierBuffer.length;

        for (let i = 0; i < carrierInput.length; i++) {
            // Write incoming samples to ring buffers
            this.carrierBuffer[this.inputWriteIdx] = carrierInput[i];
            this.modulatorBuffer[this.inputWriteIdx] = modulatorInput[i];
            this.inputWriteIdx = (this.inputWriteIdx + 1) % bufSize;
            this.samplesBuffered++;

            // Process a frame if we have enough samples
            if (this.samplesBuffered >= this.hopSize) {
                // Ensure we have at least fftSize samples in the buffer to process
                // Wait until buffer has filled up initially
                // To simplify, we actually process backwards from inputWriteIdx
                this.processFrame(bufSize, resynthesisAmt);

                this.samplesBuffered -= this.hopSize;
                this.outputWriteIdx = (this.outputWriteIdx + this.hopSize) % bufSize;
            }

            // Output the accumulated signal
            const outSample = this.outputBuffer[this.outputReadIdx];
            // Clear the buffer after reading
            this.outputBuffer[this.outputReadIdx] = 0;
            this.outputReadIdx = (this.outputReadIdx + 1) % bufSize;

            // Apply mix (0 = modulator only, 1 = full vocoder)
            const mix = isMixConstant ? mixParams[0] : mixParams[i];
            const finalOut = outSample * mix + modulatorInput[i] * (1 - mix);

            outputChannelL[i] = finalOut;
            if (outputChannelR) {
                outputChannelR[i] = finalOut;
            }
        }

        return true;
    }

    private processFrame(bufSize: number, resynthesisAmt: number) {
        // 1. Gather samples and apply window
        // The most recent sample is at (inputWriteIdx - 1).
        // We want to grab the last `fftSize` samples.
        let readPtr = (this.inputWriteIdx - this.fftSize + bufSize) % bufSize;

        for (let i = 0; i < this.fftSize; i++) {
            this.carrierRe[i] = this.carrierBuffer[readPtr] * this.window[i];
            this.carrierIm[i] = 0;
            this.modulatorRe[i] = this.modulatorBuffer[readPtr] * this.window[i];
            this.modulatorIm[i] = 0;
            readPtr = (readPtr + 1) % bufSize;
        }

        // 2. FFT
        this.fft.forward(this.carrierRe, this.carrierIm);
        this.fft.forward(this.modulatorRe, this.modulatorIm);

        // 3. Extract Spectral Envelope (Formants) from Modulator
        // Simple moving average smoothing to find peaks
        const halfSize = this.fftSize / 2;
        const smoothingRadius = 4; // Bins

        for (let i = 0; i <= halfSize; i++) {
            let sum = 0;
            let count = 0;
            for (let j = Math.max(0, i - smoothingRadius); j <= Math.min(halfSize, i + smoothingRadius); j++) {
                sum += Math.sqrt(this.modulatorRe[j]*this.modulatorRe[j] + this.modulatorIm[j]*this.modulatorIm[j]);
                count++;
            }
            this.smoothedEnvelope[i] = sum / count;
        }

        // 4. Apply Envelope to Carrier
        for (let i = 0; i <= halfSize; i++) {
            const magC = Math.sqrt(this.carrierRe[i]*this.carrierRe[i] + this.carrierIm[i]*this.carrierIm[i]);

            if (magC > 0.0001) {
                // Normalize carrier bin amplitude and multiply by modulator envelope
                const scale = this.smoothedEnvelope[i] / magC;
                this.carrierRe[i] *= scale;
                this.carrierIm[i] *= scale;
            } else {
                this.carrierRe[i] = 0;
                this.carrierIm[i] = 0;
            }

            // Mirror upper half for IFFT
            if (i > 0 && i < halfSize) {
                this.carrierRe[this.fftSize - i] = this.carrierRe[i];
                this.carrierIm[this.fftSize - i] = -this.carrierIm[i];
            }
        }

        // Ensure Nyquist is real
        this.carrierIm[halfSize] = 0;

        // 5. IFFT
        this.fft.inverse(this.carrierRe, this.carrierIm);

        // 6. Overlap-Add to output buffer
        // Note: The STFT was taken for samples ending at inputWriteIdx.
        // We need to add them to the output buffer starting at (outputWriteIdx - fftSize + hopSize)
        // because outputWriteIdx represents the start of the *next* hop to be played.
        let outPtr = (this.outputWriteIdx - this.fftSize + this.hopSize + bufSize) % bufSize;

        // Gain compensation for overlap and windowing
        const overlapFactor = this.fftSize / this.hopSize;
        const gain = 1.0 / (overlapFactor * 0.5); // 0.5 is approx integral of Hann window^2

        for (let i = 0; i < this.fftSize; i++) {
            this.outputBuffer[outPtr] += this.carrierRe[i] * this.window[i] * gain;
            outPtr = (outPtr + 1) % bufSize;
        }
    }
}

registerProcessor("vocoder-processor", VocoderProcessor);
