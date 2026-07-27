import { describe, it, expect, vi, beforeEach } from 'vitest';
import { engineDegradationStore } from '../engineDegradationStore';
import { loadingProgressStore } from '../loadingProgressStore';

describe('engineDegradationStore', () => {
    beforeEach(() => {
        engineDegradationStore.clear('gpu-knobs');
        engineDegradationStore.clear('open303');
        engineDegradationStore.clear('webgpu-scope');
        loadingProgressStore.clearRuntimeDegradation('gpu-knobs');
    });

    it('reports and lists active degradations', () => {
        engineDegradationStore.report({
            id: 'open303',
            subsystem: 'open303',
            category: 'worklet',
            message: 'open303 using JS fallback',
            reason: 'wasm load failed',
            status: 'active',
            activeBackend: 'js-fallback',
            requestedBackend: 'wasm-worklet',
            retryable: true,
        });

        const issues = engineDegradationStore.getIssues();
        expect(issues).toHaveLength(1);
        expect(issues[0].subsystem).toBe('open303');
        expect(loadingProgressStore.getState().runtimeDegradations.some((d) => d.subsystem === 'open303')).toBe(true);
    });

    it('resolves issues and removes them from active list', () => {
        engineDegradationStore.report({
            id: 'gpu-knobs',
            subsystem: 'gpu-knobs',
            category: 'gpu',
            message: 'GPU knobs using 2D fallback',
            reason: 'init failed',
            status: 'active',
            activeBackend: 'canvas-2d',
            requestedBackend: 'webgpu',
            retryable: true,
        });
        engineDegradationStore.resolve('gpu-knobs');
        expect(engineDegradationStore.getIssues()).toHaveLength(0);
    });

    it('invokes retry handler and resolves on success', async () => {
        const retry = vi.fn().mockResolvedValue(undefined);
        engineDegradationStore.registerRetryHandler('gpu-knobs', retry);
        engineDegradationStore.report({
            id: 'gpu-knobs',
            subsystem: 'gpu-knobs',
            category: 'gpu',
            message: 'GPU knobs using 2D fallback',
            reason: 'context lost',
            status: 'active',
            activeBackend: 'canvas-2d',
            requestedBackend: 'webgpu',
            retryable: true,
        });

        const ok = await engineDegradationStore.retry('gpu-knobs');
        expect(ok).toBe(true);
        expect(retry).toHaveBeenCalled();
        expect(engineDegradationStore.getIssues()).toHaveLength(0);
    });

    it('bridges engine fallback into store entries', () => {
        engineDegradationStore.reportEngineFallback('rust', 'wasm', 'dynamic import failed');
        const issue = engineDegradationStore.getIssue('rust');
        expect(issue?.activeBackend).toBe('js-fallback');
        expect(issue?.requestedBackend).toBe('wasm');
    });

    it('reports high-fid selection fallback (Phase-4)', () => {
        engineDegradationStore.clear('gpu-highfid-selection');
        engineDegradationStore.reportHighFidFallback({
            requested: 'gpu-highfid',
            active: 'highfid-cpu',
            reason: 'WebGPU unavailable — using High-Fidelity CPU for offline render',
            gpuAvailable: false,
        });
        const issue = engineDegradationStore.getIssue('gpu-highfid-selection');
        expect(issue?.category).toBe('gpu');
        expect(issue?.activeBackend).toBe('highfid-cpu');
        expect(issue?.requestedBackend).toBe('gpu-highfid');
        expect(issue?.retryable).toBe(true);
    });
});
