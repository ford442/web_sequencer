import { describe, it, expect, vi, afterEach } from 'vitest';
import { ensureBufferMatchesContext, resampleAudioBuffer } from '../resampleAudioBuffer';

describe('ensureBufferMatchesContext', () => {
  const originalOffline = globalThis.OfflineAudioContext;

  afterEach(() => {
    globalThis.OfflineAudioContext = originalOffline;
  });

  it('returns the same buffer when rates already match', async () => {
    const buffer = { sampleRate: 48000, duration: 1, numberOfChannels: 1 } as AudioBuffer;
    const context = { sampleRate: 48000 } as BaseAudioContext;
    const result = await ensureBufferMatchesContext(buffer, context);
    expect(result).toBe(buffer);
  });

  it('resamples once through OfflineAudioContext when rates differ', async () => {
    const rendered = { sampleRate: 48000 } as AudioBuffer;
    const startRendering = vi.fn().mockResolvedValue(rendered);
    const connect = vi.fn();
    const start = vi.fn();
    const createBufferSource = vi.fn().mockReturnValue({
      buffer: null as AudioBuffer | null,
      connect,
      start,
    });

    globalThis.OfflineAudioContext = vi.fn().mockImplementation(() => ({
      createBufferSource,
      destination: {},
      startRendering,
    })) as unknown as typeof OfflineAudioContext;

    const buffer = { sampleRate: 44100, duration: 0.5, numberOfChannels: 1 } as AudioBuffer;
    const context = { sampleRate: 48000 } as BaseAudioContext;
    const result = await resampleAudioBuffer(buffer, context.sampleRate);
    expect(globalThis.OfflineAudioContext).toHaveBeenCalled();
    expect(startRendering).toHaveBeenCalled();
    expect(result).toBe(rendered);
  });
});
