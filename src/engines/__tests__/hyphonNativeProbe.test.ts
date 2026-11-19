import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    getHyphonNativeStatus,
    HYPHON_NATIVE_FAILED_EVENT,
    HYPHON_NATIVE_PROBE_TIMEOUT_MS,
    HYPHON_NATIVE_READY_EVENT,
    isHyphonNativeReady,
    probeHyphonNative,
    resetHyphonNativeProbeForTests,
} from '../hyphonNativeProbe';

/** Smallest valid module: magic + version. */
const EMPTY_WASM = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);

describe('hyphonNativeProbe', () => {
    beforeEach(() => {
        resetHyphonNativeProbeForTests();
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('fetches and validates the profile a voice would pick, without instantiating it', async () => {
        const fetchMock = vi.fn(() => Promise.resolve(new Response(EMPTY_WASM)));
        vi.stubGlobal('fetch', fetchMock);
        const instantiate = vi.spyOn(WebAssembly, 'instantiate');
        const onReady = vi.fn();
        window.addEventListener(HYPHON_NATIVE_READY_EVENT, onReady);

        await expect(probeHyphonNative()).resolves.toBe(true);

        // happy-dom is not crossOriginIsolated → the single-threaded build.
        expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/hyphon_native\.st\.wasm$/), expect.anything());
        expect(instantiate).not.toHaveBeenCalled();
        expect(isHyphonNativeReady()).toBe(true);
        expect(onReady).toHaveBeenCalledTimes(1);
        window.removeEventListener(HYPHON_NATIVE_READY_EVENT, onReady);
    });

    it('stays not-ready (and says why) when the artifact is missing', async () => {
        vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('not found', { status: 404 }))));
        await expect(probeHyphonNative()).resolves.toBe(false);
        expect(isHyphonNativeReady()).toBe(false);
        expect(console.error).toHaveBeenCalledWith(expect.stringContaining('hyphon_native.st.wasm unavailable'));
    });

    it('rejects bytes that are not a wasm module', async () => {
        vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('<!doctype html>'))));
        await expect(probeHyphonNative()).resolves.toBe(false);
        expect(isHyphonNativeReady()).toBe(false);
    });

    it('settles as failed (JS fallbacks active) instead of staying pending forever', async () => {
        vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('not found', { status: 404 }))));
        const onFailed = vi.fn();
        window.addEventListener(HYPHON_NATIVE_FAILED_EVENT, onFailed);
        expect(getHyphonNativeStatus()).toBe('pending');

        await probeHyphonNative();

        expect(getHyphonNativeStatus()).toBe('failed');
        expect(onFailed).toHaveBeenCalledTimes(1);
        window.removeEventListener(HYPHON_NATIVE_FAILED_EVENT, onFailed);
    });

    it('a fetch that never answers fails after the timeout', async () => {
        vi.useFakeTimers();
        try {
            vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => new Promise((_resolve, reject) => {
                init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
            })));
            const probe = probeHyphonNative();
            await vi.advanceTimersByTimeAsync(HYPHON_NATIVE_PROBE_TIMEOUT_MS + 1);
            await expect(probe).resolves.toBe(false);
            expect(getHyphonNativeStatus()).toBe('failed');
        } finally {
            vi.useRealTimers();
        }
    });

    it('reports ready when the module is there', async () => {
        vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(EMPTY_WASM))));
        await probeHyphonNative();
        expect(getHyphonNativeStatus()).toBe('ready');
    });

    it('probes once per page', async () => {
        const fetchMock = vi.fn(() => Promise.resolve(new Response(EMPTY_WASM)));
        vi.stubGlobal('fetch', fetchMock);
        await Promise.all([probeHyphonNative(), probeHyphonNative()]);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
});
