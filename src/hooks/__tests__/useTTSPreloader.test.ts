import { describe, it, expect, vi } from 'vitest';
import { useTTSPreloader } from '../useTTSPreloader';
import { SupertonicService } from '../../services/Supertonic';
import { renderHook, waitFor } from '@testing-library/react';

describe('useTTSPreloader', () => {
  it('retries preload after Supertonic becomes ready', async () => {
    const service = SupertonicService.getInstance();
    const preloadSpy = vi.spyOn(service, 'preload').mockResolvedValue(undefined);
    vi.spyOn(service, 'isServiceReady').mockReturnValue(false);
    vi.spyOn(service, 'getPreloadManifest').mockReturnValue([true]);

    renderHook(() => useTTSPreloader());

    expect(preloadSpy).not.toHaveBeenCalled();

    vi.spyOn(service, 'isServiceReady').mockReturnValue(true);

    await waitFor(() => {
      expect(preloadSpy).toHaveBeenCalled();
    }, { timeout: 3000 });
  });
});
