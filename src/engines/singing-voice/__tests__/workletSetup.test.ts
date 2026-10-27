import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkletSetupMixin } from '../workletSetup';
import type { SingingVoiceHost } from '../host';
import { WORKLET_PERF_MSG_TYPE } from '../../../audio-worklets/workletPerfReporter';

/**
 * #1492 — the Rubber Band worklet runs process() while INIT_WASM is still
 * compiling, so its perf reporter can post before READY. On a loaded Firefox
 * that happened for a few of the 12 voices: the ready wait took the perf report
 * as its answer, dropped its timeout and never settled, so
 * SingingVoiceManager.init (and the drum kit wired after it) never finished.
 */

type Port = { onmessage: ((e: MessageEvent) => void) | null; postMessage: ReturnType<typeof vi.fn> };

function makeHost(): { host: SingingVoiceHost; port: () => Port } {
    const audioContext = {
        audioWorklet: { addModule: vi.fn().mockResolvedValue(undefined) },
    } as unknown as AudioContext;
    const host = {
        audioContext,
        workletNode: null,
        detachWorkletPerf: null,
        config: { bufferSize: 1024 },
    } as unknown as SingingVoiceHost;
    return { host, port: () => (host.workletNode as unknown as { port: Port }).port };
}

/** Let addModule resolve and initWorklet reach its ready wait. */
async function untilWaiting(port: () => Port | undefined): Promise<Port> {
    await vi.waitFor(() => expect(port()?.onmessage).toBeTypeOf('function'));
    return port()!;
}

const emit = (port: Port, data: unknown) => port.onmessage?.({ data } as MessageEvent);

describe('WorkletSetupMixin.initWorklet ready wait', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('ignores a perf report that arrives before READY', async () => {
        const { host, port } = makeHost();
        const init = WorkletSetupMixin.initWorklet.call(host, false, new ArrayBuffer(8));
        const p = await untilWaiting(() => (host.workletNode ? port() : undefined));

        emit(p, { type: WORKLET_PERF_MSG_TYPE, cpuPercent: 1 });
        expect(p.onmessage).toBeTypeOf('function');
        emit(p, { type: 'READY', fxBackend: 'native' });

        await expect(init).resolves.toBeUndefined();
    });

    it('still rejects on ERROR after a perf report', async () => {
        const { host, port } = makeHost();
        const init = WorkletSetupMixin.initWorklet.call(host, false, new ArrayBuffer(8));
        const p = await untilWaiting(() => (host.workletNode ? port() : undefined));

        emit(p, { type: WORKLET_PERF_MSG_TYPE });
        emit(p, { type: 'ERROR', error: 'boom' });

        await expect(init).rejects.toThrow(/boom/);
    });

    it('times out when only perf reports arrive', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        const { host, port } = makeHost();
        const init = WorkletSetupMixin.initWorklet.call(host, false, new ArrayBuffer(8));
        const settled = init.catch((e: unknown) => e);
        const p = await untilWaiting(() => (host.workletNode ? port() : undefined));

        emit(p, { type: WORKLET_PERF_MSG_TYPE });
        vi.advanceTimersByTime(5_000);

        const err = await settled;
        expect(err).toBeInstanceOf(Error);
        expect((err as Error).message).toMatch(/timeout/);
    });
});
