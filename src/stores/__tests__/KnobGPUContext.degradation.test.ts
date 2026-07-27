import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { KnobGPUContext } from '../../components/KnobGPUContext';
import { engineDegradationStore } from '../engineDegradationStore';

describe('KnobGPUContext degradation', () => {
    beforeEach(() => {
        (KnobGPUContext as unknown as { __resetForTests: () => void }).__resetForTests();
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
