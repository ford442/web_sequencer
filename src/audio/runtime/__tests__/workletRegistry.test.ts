import { beforeEach, describe, expect, it, vi } from 'vitest';
import { engineDegradationStore } from '../../../stores/engineDegradationStore';
import { loadWorkletModule, WorkletLoadError } from '../workletRegistry';

type FakeContext = BaseAudioContext & {
    addModule: ReturnType<typeof vi.fn>;
    setState: (state: AudioContextState) => void;
};

function fakeContext(addModule: (url: string) => Promise<void> = () => Promise.resolve()): FakeContext {
    const listeners = new Set<() => void>();
    let state: AudioContextState = 'running';
    const mock = vi.fn(addModule);
    return {
        get state() { return state; },
        audioWorklet: { addModule: mock },
        addEventListener: (type: string, fn: () => void) => { if (type === 'statechange') listeners.add(fn); },
        removeEventListener: (_type: string, fn: () => void) => { listeners.delete(fn); },
        addModule: mock,
        setState(next: AudioContextState) {
            state = next;
            for (const fn of listeners) fn();
        },
    } as unknown as FakeContext;
}

describe('loadWorkletModule', () => {
    beforeEach(() => {
        engineDegradationStore.clear('worklet-test-processor');
    });

    it('loads a (context, url) once and shares the promise between callers', async () => {
        const ctx = fakeContext();
        const a = loadWorkletModule(ctx, '/a.js', 'test-processor');
        const b = loadWorkletModule(ctx, '/a.js', 'test-processor');
        expect(a).toBe(b);
        await Promise.all([a, b]);
        await loadWorkletModule(ctx, '/a.js', 'test-processor');
        expect(ctx.addModule).toHaveBeenCalledTimes(1);
    });

    it('loads again on a different context, and for a different url', async () => {
        const one = fakeContext();
        const two = fakeContext();
        await loadWorkletModule(one, '/a.js', 'test-processor');
        await loadWorkletModule(two, '/a.js', 'test-processor');
        await loadWorkletModule(one, '/b.js', 'test-processor');
        expect(one.addModule).toHaveBeenCalledTimes(2);
        expect(two.addModule).toHaveBeenCalledTimes(1);
    });

    it('drops a rejected load so the next call re-fetches', async () => {
        let fail = true;
        const ctx = fakeContext(() => (fail ? Promise.reject(new Error('404')) : Promise.resolve()));
        await expect(loadWorkletModule(ctx, '/a.js', 'test-processor')).rejects.toBeInstanceOf(WorkletLoadError);
        fail = false;
        await loadWorkletModule(ctx, '/a.js', 'test-processor');
        expect(ctx.addModule).toHaveBeenCalledTimes(2);
    });

    it('re-loads after the context is closed', async () => {
        const ctx = fakeContext();
        await loadWorkletModule(ctx, '/a.js', 'test-processor');
        ctx.setState('closed');
        await loadWorkletModule(ctx, '/a.js', 'test-processor');
        expect(ctx.addModule).toHaveBeenCalledTimes(2);
    });

    it('rejects with a typed error and reports once per (context, url)', async () => {
        const report = vi.spyOn(engineDegradationStore, 'report');
        const cause = new Error('addModule: 404');
        const ctx = fakeContext(() => Promise.reject(cause));
        const err = await loadWorkletModule(ctx, '/a.js', 'test-processor').catch((e: unknown) => e);
        expect(err).toBeInstanceOf(WorkletLoadError);
        expect(err).toMatchObject({ url: '/a.js', processorName: 'test-processor', cause, message: 'addModule: 404' });
        await loadWorkletModule(ctx, '/a.js', 'test-processor').catch(() => undefined);
        expect(report).toHaveBeenCalledTimes(1);
        expect(report.mock.calls[0][0]).toMatchObject({ category: 'worklet', reason: 'addModule: 404', retryable: true });
        report.mockRestore();
    });

    it('rejects when the context has no audioWorklet', async () => {
        const ctx = { state: 'running' } as unknown as BaseAudioContext;
        await expect(loadWorkletModule(ctx, '/a.js', 'test-processor')).rejects.toBeInstanceOf(WorkletLoadError);
    });
});
