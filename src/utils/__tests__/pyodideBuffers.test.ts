import { describe, it, expect, vi } from 'vitest';
import { generatePyodideLoopBuffer } from '../pyodideBuffers';

describe('generatePyodideLoopBuffer', () => {
  it('builds an AudioBuffer from a synchronous Pyodide proxy', () => {
    const samples = new Float32Array([0, 0.5, -0.5, 0.25]);
    const pyProxy = {
      toJs: () => samples,
      destroy: vi.fn(),
    };
    const pyodide = {
      globals: {
        get: (name: string) => {
          if (name === 'set_sample_rate') return vi.fn();
          return () => pyProxy;
        },
      },
    };
    const context = {
      sampleRate: 44100,
      createBuffer: vi.fn((ch: number, len: number, sr: number) => ({
        length: len,
        sampleRate: sr,
        getChannelData: () => new Float32Array(len),
      })),
    } as unknown as AudioContext;

    const buf = generatePyodideLoopBuffer(pyodide, context, 'saw');
    expect(buf).not.toBeNull();
    expect(context.createBuffer).toHaveBeenCalledWith(1, samples.length, 44100);
    expect(pyProxy.destroy).toHaveBeenCalled();
  });
});
