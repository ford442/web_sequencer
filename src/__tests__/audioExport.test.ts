import { describe, it, expect } from 'vitest';
import { audioBufferToWav } from '../utils/audioExport';

describe('audioExport', () => {
    describe('audioBufferToWav', () => {
        it('should create a valid WAV file from AudioBuffer', async () => {
            const sampleRate = 44100;
            const length = 100; // Small buffer
            const numberOfChannels = 2;

            // Create data
            const channel0 = new Float32Array(length);
            const channel1 = new Float32Array(length);

            // Fill with known pattern
            // Sample 0: 0.0 -> 0
            // Sample 1: 1.0 -> 32767
            // Sample 2: -1.0 -> -32767/8
            // Sample 3: 0.5 -> ~16384
            channel0[0] = 0; channel1[0] = 0;
            channel0[1] = 1.0; channel1[1] = 1.0;
            channel0[2] = -1.0; channel1[2] = -1.0;
            channel0[3] = 0.5; channel1[3] = 0.5;

            const mockBuffer = {
                length,
                numberOfChannels,
                sampleRate,
                getChannelData: (channel: number) => channel === 0 ? channel0 : channel1
            } as unknown as AudioBuffer;

            const blob = await audioBufferToWav(mockBuffer);
            expect(blob.type).toBe('audio/wav');

            const buffer = await blob.arrayBuffer();
            const view = new DataView(buffer);

            // Check RIFF header
            expect(view.getUint32(0, true)).toBe(0x46464952); // RIFF (LE? Wait, RIFF is big endian ASCII? No, stored as bytes 52 49 46 46)
            // 0x46464952 is 'RIFF' in little endian interpretation?
            // 'R' = 0x52, 'I' = 0x49, 'F' = 0x46.
            // 52 49 46 46.
            // DataView.getUint32(0, true) reads Little Endian.
            // So byte 0 is LSB. 0x46 is LSB? No. 'R' is first byte.
            // If we write 'R' 'I' 'F' 'F' -> 0x52 0x49 0x46 0x46.
            // getUint32(0, true) -> 0x46464952. Correct.

            // Check WAVE
            expect(view.getUint32(8, true)).toBe(0x45564157); // WAVE

            // Check fmt
            expect(view.getUint32(12, true)).toBe(0x20746d66); // "fmt "

            // Check channels
            expect(view.getUint16(22, true)).toBe(numberOfChannels);

            // Check sample rate
            expect(view.getUint32(24, true)).toBe(sampleRate);

            // Check bits per sample
            expect(view.getUint16(34, true)).toBe(16);

            // Check data chunk header
            expect(view.getUint32(36, true)).toBe(0x61746164); // "data"

            // Check sample data at offset 44
            // Sample 0 (0.0) -> 0
            expect(view.getInt16(44, true)).toBe(0); // Left
            expect(view.getInt16(46, true)).toBe(0); // Right

            // Sample 1 (1.0) -> 32767
            expect(view.getInt16(48, true)).toBe(32767); // Left
            expect(view.getInt16(50, true)).toBe(32767); // Right

            // Sample 2 (-1.0) -> -32767 or -32768
            // Original implementation: sample < 0 ? sample * 32768 : sample * 32767
            // -1.0 * 32768 = -32768
            expect(view.getInt16(52, true)).toBe(-32768);

            // Sample 3 (0.5) -> 0.5 * 32767 = 16383.5 -> 16383 (floor/trunc)
            expect(view.getInt16(56, true)).toBe(16383);
        });

        it('should create a valid 24-bit WAV file', async () => {
            const sampleRate = 48000;
            const length = 4;
            const channel0 = new Float32Array([0, 0.5, -0.5, 1]);
            const mockBuffer = {
                length,
                numberOfChannels: 1,
                sampleRate,
                getChannelData: () => channel0,
            } as unknown as AudioBuffer;

            const blob = await audioBufferToWav(mockBuffer, { bitDepth: 24, sampleRate: 48000 });
            const buffer = await blob.arrayBuffer();
            const view = new DataView(buffer);

            expect(view.getUint16(34, true)).toBe(24);
            expect(view.getUint32(24, true)).toBe(48000);
            expect(view.getUint32(36, true)).toBe(0x61746164);
        });
    });
});
