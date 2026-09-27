import { describe, expect, it } from 'vitest';
import { SpectralBandProcessor } from '../spectralEffects';

describe('SpectralBandProcessor GC and Performance', () => {
  it('does not allocate Arrays during a simulated audio thread run', () => {
    const spectral = new SpectralBandProcessor();
    const BLOCK_FRAMES = 128;
    const TOTAL_BLOCKS = 1000;

    const outL = new Float32Array(BLOCK_FRAMES);
    const outR = new Float32Array(BLOCK_FRAMES);
    const grainPanL = [0.5, 0.5, 0.5] as readonly number[];
    const grainPanR = [0.5, 0.5, 0.5] as readonly number[];

    // Fill with some dummy data
    for (let i = 0; i < BLOCK_FRAMES; i++) {
      outL[i] = (Math.random() * 2) - 1.0;
      outR[i] = (Math.random() * 2) - 1.0;
    }

    // Set up a proxy to track Array allocations
    let arrayAllocations = 0;
    const OriginalArray = global.Array;

    global.Array = new Proxy(OriginalArray, {
      construct(target, args) {
        arrayAllocations++;
        return new target(...args);
      },
      apply(target, thisArg, args) {
        // Handle Array(x) call without 'new'
        arrayAllocations++;
        return target.apply(thisArg, args);
      }
    });

    try {
      for (let i = 0; i < TOTAL_BLOCKS; i++) {
        spectral.applyBandSplitAndCompression({
          outL,
          outR,
          hasStereo: true,
          spectralComp: 0.5, // Turn on spectral effects to hit the loop
          spectralCompression: 0.5, // Turn on spectral compression
          grainPanSpread: 0.2,
          grainPanL,
          grainPanR,
          sampleRate: 44100
        });
      }
    } finally {
      // Always restore!
      global.Array = OriginalArray;
    }

    // Since we process 1000 blocks with 128 frames each, if it were allocating
    // an array per frame, this would be 128,000 allocations. We expect 0.
    expect(arrayAllocations).toBe(0);
  });
});