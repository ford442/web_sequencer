import { RingBuffer } from '../utils/ringBuffer';

export class SingingVoice {
    private audioContext: AudioContext;
    private workletNode: AudioWorkletNode | null = null;
    private inputRingBuffer: RingBuffer;
    private outputRingBuffer: RingBuffer;

    constructor(audioContext: AudioContext) {
        this.audioContext = audioContext;
        this.inputRingBuffer = new RingBuffer(16384); // 16k sample buffer
        this.outputRingBuffer = new RingBuffer(16384);
    }

    async init() {
        await this.audioContext.audioWorklet.addModule('/rubberband-processor.js');
        this.workletNode = new AudioWorkletNode(this.audioContext, 'rubberband-processor');

        this.workletNode.port.postMessage({
            type: 'init',
            data: {
                inputSab: this.inputRingBuffer.sab,
                outputSab: this.outputRingBuffer.sab,
            }
        });

        return new Promise<void>(resolve => {
            this.workletNode!.port.onmessage = (event) => {
                if (event.data.type === 'ready') {
                    resolve();
                }
            };
        });
    }

    getSourceNode(): AudioNode {
        return this.workletNode!;
    }

    process(input: Float32Array) {
        const chunkSize = 4096;
        let processed = 0;
        while (processed < input.length) {
            const chunk = input.subarray(processed, processed + chunkSize);
            const pushed = this.inputRingBuffer.push(chunk);
            if (pushed === 0) {
                // Buffer is full, wait and retry.
                // In a real application, a more sophisticated back-pressure mechanism
                // might be needed, but for now, a simple loop is a start.
                // This is a placeholder for a more robust solution.
                console.warn("Ring buffer full, dropping audio data.");
                break;
            }
            processed += pushed;
        }
    }

    setPitch(pitchScale: number) {
        this.workletNode?.port.postMessage({
            type: 'pitch',
            data: { pitchScale }
        });
    }

    setTimeRatio(timeRatio: number) {
        this.workletNode?.port.postMessage({
            type: 'timeRatio',
            data: { timeRatio }
        });
    }
}
