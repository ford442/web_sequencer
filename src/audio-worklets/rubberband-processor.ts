/// <reference lib="webworker" />

import { RingBuffer } from '../utils/ringBuffer';

declare const globalThis: AudioWorkletGlobalScope & {
    createRubberbandModule: () => Promise<any>;
};

class RubberbandProcessor extends AudioWorkletProcessor {
    private inputRingBuffer: RingBuffer | null = null;
    private outputRingBuffer: RingBuffer | null = null;
    private rubberband: any = null;
    private tempInputBuffer: Float32Array;
    private tempOutputBuffer: Float32Array;

    constructor() {
        super();
        this.tempInputBuffer = new Float32Array(4096);
        this.tempOutputBuffer = new Float32Array(4096);
        this.port.onmessage = this.handleMessage.bind(this);
    }

    private handleMessage(event: MessageEvent) {
        const { type, data } = event.data;
        if (type === 'init') {
            this.inputRingBuffer = new RingBuffer(data.inputSab);
            this.outputRingBuffer = new RingBuffer(data.outputSab);

            importScripts('/rubberband.js');
            globalThis.createRubberbandModule().then(module => {
                const stretcherOptions =
                    module.RubberBandStretcher.OptionProcessRealTime |
                    module.RubberBandStretcher.OptionStretchPrecise;

                this.rubberband = new module.RubberBandStretcher(
                    sampleRate,
                    1, // channels
                    stretcherOptions,
                    1.0, // initial time ratio
                    1.0 // initial pitch ratio
                );
                this.port.postMessage({ type: 'ready' });
            });
        } else if (type === 'pitch') {
            if (this.rubberband) {
                this.rubberband.setPitchScale(data.pitchScale);
            }
        } else if (type === 'timeRatio') {
            if (this.rubberband) {
                this.rubberband.setTimeRatio(data.timeRatio);
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
