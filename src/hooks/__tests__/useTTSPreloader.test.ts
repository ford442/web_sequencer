import { renderHook, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useTTSPreloader } from '../useTTSPreloader';
import { SupertonicService } from '../../services/Supertonic';

describe('useTTSPreloader Hook', () => {
    let service: SupertonicService;

    beforeEach(() => {
        service = SupertonicService.getInstance();
        service.purgeCache();
        (service as any).isReady = true;
        vi.useFakeTimers();
        vi.restoreAllMocks();
        
        // Mock cancelIdleCallback since it might not be in the jsdom environment
        if (typeof window !== 'undefined') {
            (window as any).cancelIdleCallback = vi.fn();
        }
    });

    afterEach(() => {
        vi.runOnlyPendingTimers();
        vi.useRealTimers();
    });

    it('should successfully preload using requestIdleCallback', async () => {
        const mockRequestIdleCallback = vi.fn().mockImplementation((cb) => {
            setTimeout(cb, 0); // simulate idle callback firing
            return 1;
        });
        (window as any).requestIdleCallback = mockRequestIdleCallback;

        const generateSpy = vi.spyOn(service, 'generate').mockResolvedValue(new Float32Array(10));
        
        const { result } = renderHook(() => useTTSPreloader());

        expect(result.current.isPreloading).toBe(true);
        
        // Let the timeout inside the mockRequestIdleCallback run
        await act(async () => {
            await vi.runAllTimersAsync();
        });

        expect(result.current.isPreloading).toBe(false);
        expect(result.current.manifest).toEqual(Array(8).fill(true));

        expect(mockRequestIdleCallback).toHaveBeenCalled();
        expect(generateSpy).toHaveBeenCalled();
    });

    it('should successfully preload using setTimeout fallback when requestIdleCallback is unavailable', async () => {
        const originalRequestIdleCallback = (window as any).requestIdleCallback;
        (window as any).requestIdleCallback = undefined;

        const generateSpy = vi.spyOn(service, 'generate').mockResolvedValue(new Float32Array(10));
        
        const { result } = renderHook(() => useTTSPreloader());

        expect(result.current.isPreloading).toBe(true);
        
        // Advance the 200ms timeout
        await act(async () => {
            await vi.runAllTimersAsync();
        });

        expect(result.current.isPreloading).toBe(false);
        expect(result.current.manifest).toEqual(Array(8).fill(true));

        expect(generateSpy).toHaveBeenCalled();

        (window as any).requestIdleCallback = originalRequestIdleCallback;
    });

    it('should gracefully handle preload errors and still update state', async () => {
        const mockRequestIdleCallback = vi.fn().mockImplementation((cb) => {
            setTimeout(cb, 0);
            return 1;
        });
        (window as any).requestIdleCallback = mockRequestIdleCallback;

        vi.spyOn(service, 'generate').mockRejectedValue(new Error('Preload failure'));
        
        const { result } = renderHook(() => useTTSPreloader());

        expect(result.current.isPreloading).toBe(true);
        
        await act(async () => {
            await vi.runAllTimersAsync();
        });

        expect(result.current.isPreloading).toBe(false);
        // Manifest should reflect that banks are not loaded
        expect(result.current.manifest).toEqual(Array(8).fill(false));
    });

    it('should not preload if service is not ready', async () => {
        (service as any).isReady = false;
        
        const generateSpy = vi.spyOn(service, 'generate');
        const { result } = renderHook(() => useTTSPreloader());

        expect(result.current.isPreloading).toBe(false);
        expect(result.current.manifest).toBeNull();
        
        await act(async () => {
            await vi.runAllTimersAsync();
        });
        expect(generateSpy).not.toHaveBeenCalled();
    });
});
