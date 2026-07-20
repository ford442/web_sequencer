import { describe, it, expect } from 'vitest';
import { measureMasterStemDeviation } from '../utils/stemExportMath';

function makeBuffer(channelData: Float32Array, sampleRate = 44100): AudioBuffer {
    return {
        length: channelData.length,
        numberOfChannels: 1,
        sampleRate,
        duration: channelData.length / sampleRate,
        getChannelData: () => channelData,
    } as unknown as AudioBuffer;
}

describe('stemExport', () => {
    describe('measureMasterStemDeviation', () => {
        it('returns ~0 when master equals sum of stems', () => {
            const a = new Float32Array([0.1, 0.2, -0.1]);
            const b = new Float32Array([0.05, -0.1, 0.2]);
            const sum = new Float32Array(a.length);
            for (let i = 0; i < a.length; i++) sum[i] = a[i] + b[i];

            const deviation = measureMasterStemDeviation(
                makeBuffer(sum),
                [makeBuffer(a), makeBuffer(b)],
            );
            expect(deviation).toBeLessThan(0.001);
        });

        it('returns non-zero when master diverges from stem sum', () => {
            const a = new Float32Array([0.5, 0.5, 0.5]);
            const b = new Float32Array([0.1, 0.1, 0.1]);
            const wrongMaster = new Float32Array([0.1, 0.1, 0.1]);

            const deviation = measureMasterStemDeviation(
                makeBuffer(wrongMaster),
                [makeBuffer(a), makeBuffer(b)],
            );
            expect(deviation).toBeGreaterThan(0.1);
        });
    });
});
