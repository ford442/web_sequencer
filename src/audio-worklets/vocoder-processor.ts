/// <reference lib="dom" />
/// <reference types="vite/client" />

declare class AudioWorkletProcessor {
    readonly port: MessagePort;
    process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean;
}
declare function registerProcessor(name: string, processorCtor: new () => AudioWorkletProcessor): void;

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

    private readonly FRAME_SIZE = 512;
    private readonly HOP_SIZE = 128; // 4x overlap
    private readonly numBands = 32;

    private inBufferCarrier = new Float32Array(this.FRAME_SIZE);
    private inBufferModulator = new Float32Array(this.FRAME_SIZE);
    private outBuffer = new Float32Array(this.FRAME_SIZE);

    private window = new Float32Array(this.FRAME_SIZE);

    private carrierReal = new Float32Array(this.FRAME_SIZE);
    private carrierImag = new Float32Array(this.FRAME_SIZE);
    private modReal = new Float32Array(this.FRAME_SIZE);
    private modImag = new Float32Array(this.FRAME_SIZE);

    private modMagnitude = new Float32Array(this.FRAME_SIZE);
    private carrierMagnitude = new Float32Array(this.FRAME_SIZE);

    private bitReversedIndices = new Int32Array(this.FRAME_SIZE);
    private twiddleReal = new Float32Array(this.FRAME_SIZE);
    private twiddleImag = new Float32Array(this.FRAME_SIZE);

    private bufferIndex = 0;

    constructor() {
        super();
        this.initFFT();

        // Hann window
        for (let i = 0; i < this.FRAME_SIZE; i++) {
            this.window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (this.FRAME_SIZE - 1)));
        }
    }

    private initFFT() {
        // Bit reversal
        const bits = Math.log2(this.FRAME_SIZE);
        for (let i = 0; i < this.FRAME_SIZE; i++) {
            let rev = 0;
            for (let j = 0; j < bits; j++) {
                if ((i & (1 << j)) !== 0) {
                    rev |= (1 << (bits - 1 - j));
                }
            }
            this.bitReversedIndices[i] = rev;
        }

        // Twiddle factors
        for (let k = 0; k < this.FRAME_SIZE / 2; k++) {
            const angle = (-2 * Math.PI * k) / this.FRAME_SIZE;
            this.twiddleReal[k] = Math.cos(angle);
            this.twiddleImag[k] = Math.sin(angle);
        }
    }

    private fft(real: Float32Array, imag: Float32Array, inverse: boolean = false) {
        // Bit-reverse copy
        for (let i = 0; i < this.FRAME_SIZE; i++) {
            const rev = this.bitReversedIndices[i];
            if (i < rev) {
                const tr = real[i];
                const ti = imag[i];
                real[i] = real[rev];
                imag[i] = imag[rev];
                real[rev] = tr;
                imag[rev] = ti;
            }
        }

        for (let stage = 1; stage < this.FRAME_SIZE; stage <<= 1) {
            const step = stage << 1;
            const twiddleStep = this.FRAME_SIZE / step;

            for (let group = 0; group < stage; group++) {
                const twiddleIdx = group * twiddleStep;
                const wr = this.twiddleReal[twiddleIdx];
                const wi = inverse ? -this.twiddleImag[twiddleIdx] : this.twiddleImag[twiddleIdx];

                for (let pair = group; pair < this.FRAME_SIZE; pair += step) {
                    const evenIdx = pair;
                    const oddIdx = pair + stage;

                    const evenReal = real[evenIdx];
                    const evenImag = imag[evenIdx];
                    const oddReal = real[oddIdx];
                    const oddImag = imag[oddIdx];

                    const twiddledOddReal = wr * oddReal - wi * oddImag;
                    const twiddledOddImag = wr * oddImag + wi * oddReal;

                    real[evenIdx] = evenReal + twiddledOddReal;
                    imag[evenIdx] = evenImag + twiddledOddImag;
                    real[oddIdx] = evenReal - twiddledOddReal;
                    imag[oddIdx] = evenImag - twiddledOddImag;
                }
            }
        }

        if (inverse) {
            for (let i = 0; i < this.FRAME_SIZE; i++) {
                real[i] /= this.FRAME_SIZE;
                imag[i] /= this.FRAME_SIZE;
            }
        }
    }

    process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>) {
        const carrierInput = inputs[0];
        const modulatorInput = inputs[1];
        const output = outputs[0];

        if (!carrierInput || !modulatorInput || !output ||
            carrierInput.length === 0 || modulatorInput.length === 0 || output.length === 0) {
            return true;
        }

        const mixParams = parameters.mix;
        const isMixConstant = mixParams.length === 1;

        // Ensure we process mono for the core vocoder algorithm to save CPU.
        // We'll duplicate to all output channels.
        const cIn = carrierInput[0];
        const mIn = modulatorInput[0];

        if (!cIn || !mIn) return true;

        const blockSize = cIn.length;

        for (let i = 0; i < blockSize; i++) {
            // Shift buffers
            for (let j = 0; j < this.FRAME_SIZE - 1; j++) {
                this.inBufferCarrier[j] = this.inBufferCarrier[j + 1];
                this.inBufferModulator[j] = this.inBufferModulator[j + 1];
                this.outBuffer[j] = this.outBuffer[j + 1];
            }
            this.inBufferCarrier[this.FRAME_SIZE - 1] = cIn[i];
            this.inBufferModulator[this.FRAME_SIZE - 1] = mIn[i];
            this.outBuffer[this.FRAME_SIZE - 1] = 0;

            this.bufferIndex++;

            if (this.bufferIndex >= this.HOP_SIZE) {
                this.bufferIndex = 0;
                this.processFrame();
            }

            const mix = isMixConstant ? mixParams[0] : mixParams[i];

            // outBuffer[0] contains the fully overlap-added signal
            const vocoded = this.outBuffer[0];

            for (let channel = 0; channel < output.length; ++channel) {
                const outCh = output[channel];
                const modSignal = modulatorInput[channel] ? modulatorInput[channel][i] : mIn[i];
                outCh[i] = vocoded * mix + modSignal * (1 - mix);
            }
        }

        return true;
    }

    private processFrame() {
        // Windowing and prepare for FFT
        for (let i = 0; i < this.FRAME_SIZE; i++) {
            this.carrierReal[i] = this.inBufferCarrier[i] * this.window[i];
            this.carrierImag[i] = 0;

            this.modReal[i] = this.inBufferModulator[i] * this.window[i];
            this.modImag[i] = 0;
        }

        // FFT
        this.fft(this.carrierReal, this.carrierImag, false);
        this.fft(this.modReal, this.modImag, false);

        const halfSize = this.FRAME_SIZE / 2 + 1;

        // Compute magnitudes
        for (let i = 0; i < halfSize; i++) {
            this.modMagnitude[i] = Math.sqrt(this.modReal[i] * this.modReal[i] + this.modImag[i] * this.modImag[i]);
            this.carrierMagnitude[i] = Math.sqrt(this.carrierReal[i] * this.carrierReal[i] + this.carrierImag[i] * this.carrierImag[i]);
        }

        // Symmetrize magnitudes to prevent errors, though we only really care up to Nyquist
        for (let i = halfSize; i < this.FRAME_SIZE; i++) {
            this.modMagnitude[i] = this.modMagnitude[this.FRAME_SIZE - i];
            this.carrierMagnitude[i] = this.carrierMagnitude[this.FRAME_SIZE - i];
        }

        // Extract Spectral Envelope (Formants) via Spectral Smoothing (Moving Average)
        // A more advanced version would use cepstral smoothing or LPC, but this works well for a vocoder.
        const smoothingRadius = 8;
        const envelope = new Float32Array(halfSize);

        for (let i = 0; i < halfSize; i++) {
            let sum = 0;
            let count = 0;
            for (let j = Math.max(0, i - smoothingRadius); j <= Math.min(halfSize - 1, i + smoothingRadius); j++) {
                sum += this.modMagnitude[j];
                count++;
            }
            envelope[i] = sum / count;
        }

        // Apply Modulator Envelope to Carrier (preserving Carrier Phase)
        for (let i = 0; i < halfSize; i++) {
            // We want to force the carrier's magnitude to match the modulator's envelope
            const cMag = this.carrierMagnitude[i] + 1e-10; // prevent div zero
            const targetMag = envelope[i] * 2.0; // gain compensation

            const ratio = targetMag / cMag;

            this.carrierReal[i] *= ratio;
            this.carrierImag[i] *= ratio;

            if (i > 0 && i < halfSize - 1) {
                // symmetric upper half
                this.carrierReal[this.FRAME_SIZE - i] = this.carrierReal[i];
                this.carrierImag[this.FRAME_SIZE - i] = -this.carrierImag[i]; // conjugate
            }
        }

        // Inverse FFT
        this.fft(this.carrierReal, this.carrierImag, true);

        // Overlap-add
        for (let i = 0; i < this.FRAME_SIZE; i++) {
            // 4x overlap compensation factor is ~0.5 for Hann window, but we will just scale it down slightly
            this.outBuffer[i] += this.carrierReal[i] * this.window[i] * 0.5;
        }
    }
}

registerProcessor("vocoder-processor", VocoderProcessor);
