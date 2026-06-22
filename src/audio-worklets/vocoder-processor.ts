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

    private envelopes: number[] = [];

    process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>) {
        const carrierInput = inputs[0]; // Synth A
        const modulatorInput = inputs[1]; // TTS Sampler
        const output = outputs[0];

        if (!carrierInput || !modulatorInput || !output ||
            carrierInput.length === 0 || modulatorInput.length === 0 || output.length === 0) {
            return true;
        }

        const mixParams = parameters.mix;
        const isMixConstant = mixParams.length === 1;

        // Fast attack, slow release envelope for amplitude follower
        const attack = 0.01;
        const release = 0.001;

        for (let channel = 0; channel < output.length; ++channel) {
            const carrierChannel = carrierInput[channel] || carrierInput[0];
            const modulatorChannel = modulatorInput[channel] || modulatorInput[0];
            const outputChannel = output[channel];

            if (!carrierChannel || !modulatorChannel || !outputChannel) continue;

            if (this.envelopes[channel] === undefined) {
                this.envelopes[channel] = 0;
            }

            for (let i = 0; i < outputChannel.length; ++i) {
                const c = carrierChannel[i] || 0;
                const m = modulatorChannel[i] || 0;
                const mix = isMixConstant ? mixParams[0] : mixParams[i];

                const absM = Math.abs(m);
                if (absM > this.envelopes[channel]) {
                    this.envelopes[channel] += attack * (absM - this.envelopes[channel]);
                } else {
                    this.envelopes[channel] += release * (absM - this.envelopes[channel]);
                }

                const vocoded = c * this.envelopes[channel] * 2.0;
                outputChannel[i] = vocoded * mix + m * (1 - mix);
            }
        }

        return true;
    }
}

registerProcessor("vocoder-processor", VocoderProcessor);
