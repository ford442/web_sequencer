import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RustOscillator } from '../engines/RustOscillator';
import { engineTelemetry } from '../utils/engineTelemetry';

describe('RustOscillator.init', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs fallback when dynamic import fails', async () => {
    const osc = new RustOscillator();
    await osc.init();

    expect(osc.isReady).toBe(false);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('[EngineFallback] rust'),
    );
    expect(engineTelemetry.snapshot().rust?.resolution?.backend).toBe('fallback');
  });
});