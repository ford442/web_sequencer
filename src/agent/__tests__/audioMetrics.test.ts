/**
 * The metrics `ai-song:render` writes to report.json (#1386), on synthetic
 * signals with known answers.
 */
import { describe, expect, it } from 'vitest';
import { analyzeAudio, firstOnsetSeconds, parseWav, spectralCentroid, stepsPerBar } from '../audioMetrics';

const SR = 48000;

function sine(hz: number, seconds: number, amp = 0.5, sampleRate = SR): Float32Array {
    return Float32Array.from({ length: Math.round(seconds * sampleRate) }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / sampleRate));
}

/** A minimal WAV writer: PCM 16/24 or float 32. */
function wav(channels: Float32Array[], sampleRate: number, bits: 16 | 24 | 32, float = false): Uint8Array {
    const frames = channels[0].length;
    const bytesPer = bits / 8;
    const data = frames * channels.length * bytesPer;
    const buf = new ArrayBuffer(44 + data);
    const v = new DataView(buf);
    const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
    str(0, 'RIFF'); v.setUint32(4, 36 + data, true); str(8, 'WAVE');
    str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, float ? 3 : 1, true);
    v.setUint16(22, channels.length, true); v.setUint32(24, sampleRate, true);
    v.setUint32(28, sampleRate * channels.length * bytesPer, true); v.setUint16(32, channels.length * bytesPer, true);
    v.setUint16(34, bits, true); str(36, 'data'); v.setUint32(40, data, true);
    let o = 44;
    for (let f = 0; f < frames; f++) {
        for (const ch of channels) {
            const x = ch[f];
            if (float) v.setFloat32(o, x, true);
            else if (bits === 16) v.setInt16(o, Math.round(x * 32767), true);
            else {
                const n = Math.round(x * 8388607);
                v.setUint8(o, n & 0xff); v.setUint8(o + 1, (n >> 8) & 0xff); v.setInt8(o + 2, n >> 16);
            }
            o += bytesPer;
        }
    }
    return new Uint8Array(buf);
}

describe('parseWav', () => {
    const left = sine(440, 0.05);
    const right = sine(880, 0.05, 0.25);

    it.each([
        [16, false, 1e-4],
        [24, false, 1e-6],
        [32, true, 1e-7],
    ] as const)('round-trips %i-bit (float=%s)', (bits, float, tolerance) => {
        const decoded = parseWav(wav([left, right], 44100, bits, float));
        expect(decoded.sampleRate).toBe(44100);
        expect(decoded.channels).toHaveLength(2);
        expect(decoded.channels[0].length).toBe(left.length);
        for (let i = 0; i < left.length; i += 97) {
            expect(Math.abs(decoded.channels[0][i] - left[i])).toBeLessThan(tolerance);
            expect(Math.abs(decoded.channels[1][i] - right[i])).toBeLessThan(tolerance);
        }
    });

    it('rejects a file that is not a WAV', () => {
        expect(() => parseWav(new TextEncoder().encode('MThd and other things'))).toThrow(/RIFF/);
    });
});

describe('spectralCentroid', () => {
    it('finds a sine at its frequency', () => {
        expect(spectralCentroid(sine(1000, 0.5), SR)).toBeGreaterThan(950);
        expect(spectralCentroid(sine(1000, 0.5), SR)).toBeLessThan(1050);
    });

    it('is null on silence', () => {
        expect(spectralCentroid(new Float32Array(SR), SR)).toBeNull();
    });
});

describe('analyzeAudio', () => {
    // 120 BPM: a 16th step is 0.125 s, a 4/4 bar 2 s.
    const grid = { stepSeconds: 0.125, stepsPerBar: 16 };

    it('reports level, loudness and a centroid per bar that follows a rising tone', () => {
        const tone = new Float32Array(SR * 6);
        tone.set(sine(300, 2), 0);
        tone.set(sine(1200, 2), SR * 2);
        tone.set(sine(4800, 2, 0.05), SR * 4);
        const m = analyzeAudio([tone, tone], SR, grid);
        expect(m.durationSeconds).toBe(6);
        expect(m.silent).toBe(false);
        expect(m.peakDbfs).toBeCloseTo(-6.02, 1);
        expect(m.integratedLufs).not.toBeNull();
        expect(m.bars.map((b) => b.bar)).toEqual([1, 2, 3]);
        const [a, b, c] = m.bars.map((bar) => bar.centroidHz!);
        expect(a).toBeLessThan(b);
        expect(b).toBeLessThan(c);
        // Bar 3 is 20 dB down.
        expect(m.bars[0].rmsDbfs! - m.bars[2].rmsDbfs!).toBeCloseTo(20, 0);
    });

    it('marks digital silence silent, with nulls rather than -Infinity', () => {
        const m = analyzeAudio([new Float32Array(SR)], SR, grid);
        expect(m).toMatchObject({ silent: true, peak: 0, peakDbfs: null, integratedLufs: null, rmsDbfs: null });
        expect(m.bars[0]).toMatchObject({ rmsDbfs: null, centroidHz: null });
        expect(JSON.parse(JSON.stringify(m))).toEqual(m);
    });

    it('counts a noise floor under the -70 LUFS gate as silent', () => {
        // A hiss floor above the -80 dBFS peak threshold but under the gate.
        const floor = Float32Array.from({ length: SR * 2 }, (_, i) => ((i * 7919) % 17 - 8) / 8 * 0.00015);
        const m = analyzeAudio([floor, floor], SR, grid);
        expect(m.peak).toBeGreaterThan(1e-4);
        expect(m.integratedLufs).toBeNull();
        expect(m.silent).toBe(true);
    });

    it('starts bar 1 at the offset', () => {
        const m = analyzeAudio([new Float32Array(SR * 3)], SR, { ...grid, offsetSeconds: 0.5 });
        expect(m.bars.map((b) => b.startSeconds)).toEqual([0.5, 2.5]);
    });
});

describe('helpers', () => {
    it('finds the first onset', () => {
        const signal = new Float32Array(SR);
        signal.set(sine(440, 0.2), SR / 4);
        expect(firstOnsetSeconds([signal], SR)).toBeCloseTo(0.25, 2);
        expect(firstOnsetSeconds([new Float32Array(SR)], SR)).toBeNull();
    });

    it('counts 16th steps per bar from the time signature', () => {
        expect(stepsPerBar(undefined)).toBe(16);
        expect(stepsPerBar([3, 4])).toBe(12);
        expect(stepsPerBar([7, 8])).toBe(14);
    });
});
