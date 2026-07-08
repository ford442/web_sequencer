import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { KnobGPUContext } from '../../components/KnobGPUContext';
import { engineDegradationStore } from '../engineDegradationStore';

describe('KnobGPUContext degradation', () => {
    beforeEach(() => {
        const ctx = KnobGPUContext as unknown as {
            device: GPUDevice | null;
            slots: Map<number, unknown>;
            registrations: Map<number, unknown>;
            pendingIds: Set<number>;
            initPromise: Promise<boolean> | null;
            rafId: number | null;
            status: string;
            consecutiveRenderFailures: number;
            recoverScheduled: boolean;
            deviceLostHandled: boolean;
        };
        ctx.device = null;
        ctx.slots.clear();
        ctx.registrations.clear();
        ctx.pendingIds.clear();
        ctx.initPromise = null;
        ctx.rafId = null;
        ctx.status = 'unavailable';
        ctx.consecutiveRenderFailures = 0;
        ctx.recoverScheduled = false;
        ctx.deviceLostHandled = false;
        engineDegradationStore.clear('gpu-knobs');
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('returns null and reports when navigator.gpu is missing', () => {
        vi.stubGlobal('navigator', {});
        const canvas = document.createElement('canvas');
        const handle = KnobGPUContext.register(canvas, () => 0.5);
        expect(handle).toBeNull();
        expect(KnobGPUContext.getStatus()).toBe('unavailable');
        expect(engineDegradationStore.getIssue('gpu-knobs')?.reason).toContain('navigator.gpu');
    });

    it('isSlotActive is false until GPU slot attaches', () => {
        vi.stubGlobal('navigator', { gpu: undefined });
        const handle = KnobGPUContext.register(document.createElement('canvas'), () => 0);
        expect(KnobGPUContext.isSlotActive(handle)).toBe(false);
    });
});
