import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SupertonicService } from '../Supertonic';

// Mock generate method internally for the test
const service = SupertonicService.getInstance();

describe('SupertonicService Preload & Purge', () => {
    beforeEach(() => {
        service.purgeCache();
        // Since we cannot easily bypass initialization which requires ONNX
        // we will manually force isReady for preload tests using private access
        (service as any).isReady = true;
        vi.restoreAllMocks();
    });

    it('should successfully preload and set the manifest to true', async () => {
        const generateSpy = vi.spyOn(service, 'generate').mockResolvedValue(new Float32Array(10));

        await service.preload();

        expect(generateSpy).toHaveBeenCalledWith("a", 1, 1.0);
        expect(service.getPreloadManifest()).toEqual(Array(8).fill(true));
        // Should not preload if already preloading or not ready
        (service as any).isReady = false;
    });

    it('should handle preload errors gracefully and reset isPreloading state', async () => {
        const generateSpy = vi.spyOn(service, 'generate').mockRejectedValue(new Error('Dummy inference failed'));

        await service.preload();

        expect(generateSpy).toHaveBeenCalledWith("a", 1, 1.0);
        // It failed, so manifest is not updated
        expect(service.getPreloadManifest()).toEqual(Array(8).fill(false));
        expect((service as any).isPreloading).toBe(false);
    });

    it('should successfully purge cache and reset readiness and manifest', () => {
        // Pretend we have a populated models object
        (service as any).models = {
            'voice_partA': { release: vi.fn() },
            'voice_partB': { release: vi.fn() },
        };
        (service as any).preloadManifest = Array(8).fill(true);
        (service as any).isReady = true;

        service.purgeCache();

        expect((service as any).models).toEqual({});
        expect((service as any).isReady).toBe(false);
        expect(service.getPreloadManifest()).toEqual(Array(8).fill(false));
    });
});
