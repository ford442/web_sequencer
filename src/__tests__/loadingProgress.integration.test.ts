import { describe, it, expect } from 'vitest';
import { loadingProgressStore } from '../stores/loadingProgressStore';

describe('loadingProgressStore integration', () => {
  it('tracks weighted steps through a simulated audio init sequence', () => {
    loadingProgressStore.startLoading();
    loadingProgressStore.startStep('audioContext');
    loadingProgressStore.completeStep('audioContext');
    loadingProgressStore.startStep('masterChain');
    loadingProgressStore.completeStep('masterChain');

    const mid = loadingProgressStore.getState();
    expect(mid.isLoading).toBe(true);
    expect(mid.totalProgress).toBeGreaterThan(0);

    loadingProgressStore.completeStep('complete');
    loadingProgressStore.finishLoading();

    const done = loadingProgressStore.getState();
    expect(done.isLoading).toBe(false);
    expect(done.totalProgress).toBe(100);
  });
});
