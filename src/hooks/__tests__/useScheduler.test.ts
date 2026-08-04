import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useScheduler } from '../useScheduler';

// vitest.setup.ts installs a plain (non-spy) AudioContext / AudioWorkletNode mock
// on `window`. These tests need to assert on construction + port messages, so we
// swap in a spy-friendly AudioWorkletNode for the duration of this file.
class FakeWorkletNode {
    port: { postMessage: ReturnType<typeof vi.fn>; onmessage: unknown; addEventListener: ReturnType<typeof vi.fn>; removeEventListener: ReturnType<typeof vi.fn> };
    connect = vi.fn();
    disconnect = vi.fn();
    constructor(..._args: unknown[]) {
        this.port = {
            postMessage: vi.fn(),
            onmessage: null,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
        };
        createdNodes.push(this);
    }
}

let createdNodes: FakeWorkletNode[] = [];

function makeContext(state: AudioContextState = 'running'): AudioContext {
    const context = new (window.AudioContext as unknown as { new (): AudioContext })();
    (context as { state: AudioContextState }).state = state;
    return context;
}

describe('useScheduler', () => {
    let originalWorkletNode: unknown;

    beforeEach(() => {
        vi.clearAllMocks();
        createdNodes = [];
        originalWorkletNode = window.AudioWorkletNode;
        (window as unknown as { AudioWorkletNode: unknown }).AudioWorkletNode = FakeWorkletNode;
    });

    afterEach(() => {
        (window as unknown as { AudioWorkletNode: unknown }).AudioWorkletNode = originalWorkletNode;
    });

    it('does not start the AudioWorklet clock and logs a clear warning when the engine is not ready', async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const context = makeContext();
        const onStep = vi.fn();

        const { result } = renderHook(() =>
            useScheduler(120, 32, onStep, /* isAudioReady */ false, context),
        );

        act(() => {
            result.current.setIsPlaying(true);
        });

        await act(async () => {
            await Promise.resolve();
        });

        expect(createdNodes).toHaveLength(0);
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[useScheduler]'));
    });

    it('starts the AudioWorklet clock and posts a start message once the engine is ready', async () => {
        const context = makeContext();
        const onStep = vi.fn();

        const { result } = renderHook(() =>
            useScheduler(120, 32, onStep, /* isAudioReady */ true, context),
        );

        act(() => {
            result.current.setIsPlaying(true);
        });

        await waitFor(() => expect(createdNodes).toHaveLength(1));

        expect(createdNodes[0].port.postMessage).toHaveBeenCalledWith({ type: 'start' });
        expect(createdNodes[0].connect).toHaveBeenCalledWith(context.destination);
        expect(result.current.isPlaying).toBe(true);
    });

    it('stops the clock and leaves no orphan node when toggled off', async () => {
        const context = makeContext();
        const onStep = vi.fn();

        const { result } = renderHook(() =>
            useScheduler(120, 32, onStep, /* isAudioReady */ true, context),
        );

        act(() => {
            result.current.setIsPlaying(true);
        });

        await waitFor(() => expect(createdNodes).toHaveLength(1));
        const node = createdNodes[0];

        act(() => {
            result.current.setIsPlaying(false);
        });

        await waitFor(() => {
            expect(node.port.postMessage).toHaveBeenCalledWith({ type: 'stop' });
        });
        expect(node.disconnect).toHaveBeenCalled();
        expect(result.current.isPlaying).toBe(false);
    });
});
