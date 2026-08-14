import { describe, it, expect, vi, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { repoRoot } from '@/test/helpers/requireRepoArtifacts';
import {
  findLoopPoints,
  audioBufferToMono,
  setWasmInstance,
} from '../utils/trackFreezer';

const wasmPath = path.join(repoRoot(), 'src/wasm/trackFreezer.wasm');

describe('trackFreezer (WASM bridge)', () => {
  beforeAll(async () => {
    const buffer = fs.readFileSync(wasmPath);
    const { instance } = await WebAssembly.instantiate(buffer, {
      env: {
        abort: () => {
          throw new Error('WASM Abort');
        },
      },
    });
    setWasmInstance(instance.exports as unknown as Parameters<typeof setWasmInstance>[0]);
  });

  describe('findLoopPoints', () => {
    it('should find optimal loop points using zero-crossing detection', () => {
      const buffer = new Float32Array(10000);

      buffer[499] = -0.5;
      buffer[500] = 0.5;
      buffer[9000] = 0.5;
      buffer[8999] = -0.5;

      const result = findLoopPoints(buffer);

      expect(result.start).toBe(500);
      expect(result.end).toBe(9000);
    });

    it('should respect minimum loop length', () => {
      const buffer = new Float32Array(10000);
      const minLoop = 5000;

      buffer[499] = -0.1;
      buffer[500] = 0.1;
      buffer[1999] = -0.1;
      buffer[2000] = 0.1;
      buffer[5999] = -0.1;
      buffer[6000] = 0.1;

      const result = findLoopPoints(buffer, minLoop);

      expect(result.start).toBe(500);
      expect(result.end).toBe(6000);
    });
  });

  describe('audioBufferToMono', () => {
    it('should return channel 0 if buffer is already mono', () => {
      const monoData = new Float32Array([0.1, 0.2, 0.3]);
      const buffer = {
        numberOfChannels: 1,
        length: 3,
        getChannelData: vi.fn().mockReturnValue(monoData),
      } as unknown as AudioBuffer;

      const result = audioBufferToMono(buffer);
      expect(result).toBe(monoData);
    });

    it('should mix down stereo to mono (WASM path)', () => {
      const left = new Float32Array([0.2, 0.4, 0.6]);
      const right = new Float32Array([0.4, 0.6, 0.8]);

      const buffer = {
        numberOfChannels: 2,
        length: 3,
        getChannelData: vi.fn().mockImplementation((ch: number) => (ch === 0 ? left : right)),
      } as unknown as AudioBuffer;

      const result = audioBufferToMono(buffer);

      expect(result[0]).toBeCloseTo(0.3);
      expect(result[1]).toBeCloseTo(0.5);
      expect(result[2]).toBeCloseTo(0.7);
    });

    it('should mix down 4 channels to mono (JS fallback path)', () => {
      const c0 = new Float32Array([1.0]);
      const c1 = new Float32Array([1.0]);
      const c2 = new Float32Array([0.0]);
      const c3 = new Float32Array([0.0]);

      const bufMixed = {
        numberOfChannels: 4,
        length: 1,
        getChannelData: vi.fn().mockImplementation((ch: number) => {
          if (ch === 0) return c0;
          if (ch === 1) return c1;
          if (ch === 2) return c2;
          return c3;
        }),
      } as unknown as AudioBuffer;

      const res = audioBufferToMono(bufMixed);
      expect(res[0]).toBeCloseTo(0.5);
    });
  });
});
