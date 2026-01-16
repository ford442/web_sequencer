import { describe, it, expect } from 'vitest';
import { audioBufferToWav } from '../utils/audioExport';

// Mock AudioBuffer
class MockAudioBuffer {
    numberOfChannels: number;
    length: number;
    sampleRate: number;
    _data: Float32Array[];

    constructor(options: { numberOfChannels: number, length: number, sampleRate: number }) {
        this.numberOfChannels = options.numberOfChannels;
        this.length = options.length;
        this.sampleRate = options.sampleRate;
        this._data = Array.from({ length: this.numberOfChannels }, () => new Float32Array(this.length));
    }

    getChannelData(channel: number) {
        return this._data[channel];
    }
}

// Polyfill AudioBuffer for Node environment if needed
if (typeof AudioBuffer === 'undefined') {
    global.AudioBuffer = MockAudioBuffer as any;
}

describe('audioBufferToWav Performance', () => {
    it('benchmarks execution time', () => {
        const length = 44100 * 5; // 5 seconds
        const buffer = new MockAudioBuffer({
            numberOfChannels: 2,
            length: length,
            sampleRate: 44100
        }) as AudioBuffer;

        // Fill with random data
        for (let ch = 0; ch < 2; ch++) {
            const data = buffer.getChannelData(ch);
            for (let i = 0; i < length; i++) {
                data[i] = Math.random() * 2 - 1;
            }
        }

        const start = performance.now();
        const iterations = 100;

        for (let i = 0; i < iterations; i++) {
            audioBufferToWav(buffer);
        }

        const end = performance.now();
        const avgTime = (end - start) / iterations;

        console.log(`audioBufferToWav average time (${iterations} runs): ${avgTime.toFixed(3)}ms`);

        // Ensure it runs without error and returns reasonable metric
        expect(avgTime).toBeGreaterThan(0);
    });
});
