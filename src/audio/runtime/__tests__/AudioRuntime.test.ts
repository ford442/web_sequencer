import { describe, expect, it, vi } from 'vitest';
import { engineDegradationStore } from '../../../stores/engineDegradationStore';
import { AudioRuntime } from '../AudioRuntime';

function suspendedContext(resume: () => Promise<void>): { ctx: AudioContext; resumeMock: ReturnType<typeof vi.fn> } {
    let state: AudioContextState = 'suspended';
    const resumeMock = vi.fn(() => resume().then(() => { state = 'running'; }));
    const ctx = {
        get state() { return state; },
        resume: resumeMock,
    } as unknown as AudioContext;
    return { ctx, resumeMock };
}

describe('AudioRuntime.ensureRunning', () => {
    it('de-duplicates concurrent calls into one resume()', async () => {
        const runtime = new AudioRuntime();
        const { ctx, resumeMock } = suspendedContext(() => Promise.resolve());
        const a = runtime.ensureRunning('click', ctx);
        const b = runtime.ensureRunning('key', ctx);
        expect(a).toBe(b);
        await Promise.all([a, b]);
        expect(resumeMock).toHaveBeenCalledTimes(1);
        expect(ctx.state).toBe('running');
        await runtime.ensureRunning('click', ctx);
        expect(resumeMock).toHaveBeenCalledTimes(1);
    });

    it('never rejects, and reports a failed resume() once', async () => {
        const runtime = new AudioRuntime();
        const report = vi.spyOn(engineDegradationStore, 'report');
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const { ctx, resumeMock } = suspendedContext(() => Promise.reject(new Error('NotAllowedError')));
        await expect(runtime.ensureRunning('click', ctx)).resolves.toBeUndefined();
        await expect(runtime.ensureRunning('click', ctx)).resolves.toBeUndefined();
        expect(resumeMock).toHaveBeenCalledTimes(2);
        expect(report).toHaveBeenCalledTimes(1);
        expect(report.mock.calls[0][0]).toMatchObject({ id: 'audio-context-resume', reason: 'NotAllowedError' });
        report.mockRestore();
        warn.mockRestore();
        engineDegradationStore.clear('audio-context-resume');
    });

    it('records the gesture and publishes the live context state', async () => {
        const runtime = new AudioRuntime();
        const { ctx } = suspendedContext(() => Promise.resolve());
        runtime.adopt({ context: ctx } as Parameters<AudioRuntime['adopt']>[0]);
        const listener = vi.fn();
        runtime.subscribe(listener);
        expect(runtime.getSnapshot()).toEqual({ state: 'suspended', gestureSeen: false, lastResumeError: null });
        await runtime.ensureRunning('touch');
        expect(runtime.getSnapshot()).toEqual({ state: 'running', gestureSeen: true, lastResumeError: null });
        expect(listener).toHaveBeenCalled();
        expect(runtime.context).toBe(ctx);
    });

    it('a programmatic call does not count as a gesture', async () => {
        const runtime = new AudioRuntime();
        await runtime.ensureRunning('programmatic');
        expect(runtime.getSnapshot().gestureSeen).toBe(false);
    });
});
