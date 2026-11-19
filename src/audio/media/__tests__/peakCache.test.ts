/**
 * The peak cache (#1629 P2): stored peaks first, then a build in the worker,
 * then a build on this thread when the worker cannot help.
 */
import { describe, expect, it, vi } from 'vitest';
import { MemoryBackendForTests } from './peakTestBackend';
import { MediaStore, peaksPath } from '../MediaStore';
import { PeakCache, type PeaksWorkerRequest, type PeaksWorkerResponse } from '../peakCache';
import { buildPeaks, encodePeakFile } from '../peaks';

const audio = (frames: number) => Float32Array.from({ length: frames }, (_, i) => Math.sin(i / 10) * 0.8);

/** A worker stand-in that answers from `respond` (or fails to start). */
function fakeWorker(respond: (request: PeaksWorkerRequest) => PeaksWorkerResponse | 'crash') {
    const listeners: Record<string, ((event: unknown) => void)[]> = { message: [], error: [] };
    const worker = {
        posted: [] as PeaksWorkerRequest[],
        terminated: false,
        postMessage(request: PeaksWorkerRequest) {
            worker.posted.push(request);
            queueMicrotask(() => {
                const response = respond(request);
                if (response === 'crash') listeners.error.forEach((fn) => fn(new Event('error')));
                else listeners.message.forEach((fn) => fn({ data: response }));
            });
        },
        addEventListener(type: string, fn: (event: unknown) => void) {
            listeners[type]?.push(fn);
        },
        terminate() {
            worker.terminated = true;
        },
    };
    return worker;
}

async function storeWith(frames = 5000) {
    const backend = new MemoryBackendForTests();
    const store = new MediaStore(backend);
    const planar = [audio(frames)];
    const { id } = await store.put(planar, 48000);
    return { backend, store, id, planar };
}

describe('PeakCache', () => {
    it('loads the stored peaks file, and tells listeners', async () => {
        const { backend, store, id, planar } = await storeWith();
        await store.writePeaks(id, buildPeaks(planar));
        const cache = new PeakCache({ store, createWorker: null });
        const listener = vi.fn();
        cache.subscribe(listener);
        expect(cache.get(id)).toBeNull();
        const before = cache.version;
        cache.request([id]);
        const peaks = await cache.ensure(id);
        expect(peaks && encodePeakFile(peaks)).toEqual(backend.files.get(peaksPath(id)));
        expect(cache.get(id)).toBe(peaks);
        expect(listener).toHaveBeenCalledTimes(1);
        expect(cache.version).toBe(before + 1);
    });

    it('builds missing peaks in the worker, once per id, without touching the audio here', async () => {
        const { backend, store, id, planar } = await storeWith();
        const bytes = encodePeakFile(buildPeaks(planar));
        const worker = fakeWorker((r) => ({ type: 'peaks', id: r.id, bytes: bytes.slice() }));
        const cache = new PeakCache({ store, createWorker: () => worker });
        backend.reads = 0;
        cache.request([id, id]);
        cache.request([id]);
        const peaks = await cache.ensure(id);
        expect(worker.posted).toEqual([{ type: 'build', id }]);
        expect(peaks && encodePeakFile(peaks)).toEqual(bytes);
        // Here: only the attempt to read the peaks file (and the worker writes it, not this thread).
        expect(backend.reads).toBe(1);
        expect(backend.files.has(peaksPath(id))).toBe(false);
    });

    it('builds here, and stores the peaks, when the worker cannot see the media or dies', async () => {
        for (const answer of ['missing', 'crash'] as const) {
            const { backend, store, id, planar } = await storeWith();
            const worker = fakeWorker((r) => (answer === 'crash' ? 'crash' : { type: 'missing', id: r.id }));
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
            const cache = new PeakCache({ store, createWorker: () => worker });
            const peaks = await cache.ensure(id);
            warn.mockRestore();
            expect(peaks && encodePeakFile(peaks)).toEqual(encodePeakFile(buildPeaks(planar)));
            expect(backend.files.get(peaksPath(id))).toEqual(encodePeakFile(buildPeaks(planar)));
            expect(worker.terminated).toBe(answer === 'crash');
        }
    });

    it('builds here when no worker is wanted, and rebuilds an outdated peaks file', async () => {
        const { backend, store, id, planar } = await storeWith();
        backend.files.set(peaksPath(id), new Uint8Array([1, 2, 3]));
        const cache = new PeakCache({ store, createWorker: null });
        const peaks = await cache.ensure(id);
        expect(peaks && encodePeakFile(peaks)).toEqual(encodePeakFile(buildPeaks(planar)));
        expect(backend.files.get(peaksPath(id))).toEqual(encodePeakFile(buildPeaks(planar)));
    });

    it('never starts a worker for a store on the in-memory backend', async () => {
        const { store, id } = await storeWith();
        vi.stubGlobal('Worker', vi.fn(() => {
            throw new Error('should not start');
        }));
        try {
            const cache = new PeakCache({ store });
            expect(await cache.ensure(id)).not.toBeNull();
            expect(Worker).not.toHaveBeenCalled();
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it('remembers media the store does not hold until it is primed or retried', async () => {
        const { store } = await storeWith();
        const cache = new PeakCache({ store, createWorker: null });
        const ghost = 'b'.repeat(64);
        expect(await cache.ensure(ghost)).toBeNull();
        expect(cache.isMissing(ghost)).toBe(true);
        const spy = vi.spyOn(store, 'readPeaks');
        cache.request([ghost]);
        expect(spy).not.toHaveBeenCalled();
        cache.retry(ghost);
        expect(spy).toHaveBeenCalledTimes(1);
        const peaks = buildPeaks([audio(10)]);
        cache.prime(ghost, peaks);
        expect(cache.isMissing(ghost)).toBe(false);
        expect(cache.get(ghost)).toBe(peaks);
    });

    it('holds at most `capacity` pyramids, dropping the least recently used', () => {
        const cache = new PeakCache({ store: new MediaStore(new MemoryBackendForTests()), createWorker: null, capacity: 2 });
        const p = buildPeaks([audio(10)]);
        cache.prime('1', p);
        cache.prime('2', p);
        expect(cache.get('1')).toBe(p);
        cache.prime('3', p);
        expect(cache.get('2')).toBeNull();
        expect(cache.get('1')).toBe(p);
        expect(cache.get('3')).toBe(p);
    });
});
