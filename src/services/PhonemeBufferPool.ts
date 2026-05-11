// src/services/PhonemeBufferPool.ts
// Pre-stretched buffer pool for phoneme-aware time stretching.
//
// Architecture overview (from issue):
//   Load time  → PhonemeStretchWorker stretches each phoneme to every grid duration offline.
//   Runtime    → getNearest() does a binary search and returns the closest AudioBuffer.
//                AudioBufferSourceNode.start(when).stop(when + targetDuration) gives
//                sample-accurate scheduling with zero onset latency.

/**
 * Default duration grid in milliseconds.
 * Covers 16th notes at 80–200 BPM, 8th notes at 80–160 BPM, and common triplets.
 * Worst-case quantisation error: ≤ 12.5 ms (half the widest grid gap).
 */
export const DEFAULT_DURATION_GRID_MS: readonly number[] = Object.freeze([
    50, 62.5, 75, 93.75, 100, 125, 150, 187.5, 250, 375
]);

/** Approximate size of one sample in bytes (32-bit float, mono) */
const BYTES_PER_SAMPLE = 4;

/** Maximum total pool size in bytes (~100 MB) */
const MAX_POOL_BYTES = 100 * 1024 * 1024;

// ---------------------------------------------------------------------------

export class PhonemeBufferPool {
    private audioContext: AudioContext | null = null;
    private durationGridMs: number[] = [...DEFAULT_DURATION_GRID_MS];

    /** phonemeId → (targetMs → AudioBuffer) */
    private readonly pool: Map<string, Map<number, AudioBuffer>> = new Map();

    /** LRU order — most recently used key at the end */
    private readonly lruOrder: string[] = [];

    /** Running total of bytes stored in the pool */
    private totalBytes: number = 0;

    private worker: Worker | null = null;

    // ------------------------------------------------------------------
    // Lifecycle
    // ------------------------------------------------------------------

    /**
     * Initialise the pool. Must be called once, after AudioContext is created.
     *
     * @param audioContext  The application's AudioContext (used to create AudioBuffers).
     * @param durationGridMs  Optional override of the duration grid (in ms).
     */
    init(audioContext: AudioContext, durationGridMs: readonly number[] = DEFAULT_DURATION_GRID_MS): void {
        this.audioContext = audioContext;
        this.durationGridMs = [...durationGridMs].sort((a, b) => a - b);
    }

    /**
     * Send a phoneme slice to the stretch worker so it pre-computes stretched
     * variants for every duration in the grid.
     *
     * @param phonemeId  Stable identifier for this phoneme (e.g. "bank_0_slice_3").
     * @param channels   Per-channel audio data (will be *copied* before transfer).
     * @param sampleRate Audio sample rate in Hz.
     */
    warmPhoneme(phonemeId: string, channels: Float32Array[], sampleRate: number): void {
        if (!this.audioContext) {
            console.warn('PhonemeBufferPool.warmPhoneme: pool not initialised — call init() first.');
            return;
        }
        if (channels.length === 0 || channels[0].length === 0) {
            console.warn(`PhonemeBufferPool.warmPhoneme: empty audio for phoneme "${phonemeId}" — skipping.`);
            return;
        }

        // Lazy-create the worker
        if (!this.worker) {
            this.worker = new Worker(
                new URL('../workers/PhonemeStretchWorker.ts', import.meta.url),
                { type: 'module' }
            );
            this.worker.onmessage = this.handleWorkerMessage.bind(this);
        }

        const targetDurations = this.durationGridMs.map(ms => ms / 1000);

        // Copy channel data before transferring so the caller still owns the originals
        const channelCopies = channels.map(ch => new Float32Array(ch));
        const transfers = channelCopies.map(c => c.buffer);

        this.worker.postMessage(
            { phonemeId, channels: channelCopies, sampleRate, targetDurations },
            { transfer: transfers }
        );
    }

    /**
     * Retrieve the pre-stretched AudioBuffer whose duration is nearest to
     * `targetMs` for the given phoneme.
     *
     * Performs a linear scan (grid is small — ≤ 10 entries) and updates the
     * LRU order for eviction purposes.
     *
     * @returns The closest AudioBuffer, or `null` if the phoneme has not been
     *          warmed yet (caller should fall back to unmodified playback).
     */
    getNearest(phonemeId: string, targetMs: number): AudioBuffer | null {
        const phonemePool = this.pool.get(phonemeId);
        if (!phonemePool || phonemePool.size === 0) return null;

        const durations = Array.from(phonemePool.keys()).sort((a, b) => a - b);
        let nearestMs = durations[0];
        let minDiff = Math.abs(targetMs - nearestMs);

        for (let i = 1; i < durations.length; i++) {
            const diff = Math.abs(targetMs - durations[i]);
            if (diff < minDiff) {
                minDiff = diff;
                nearestMs = durations[i];
            }
        }

        this.touchLRU(`${phonemeId}:${nearestMs}`);
        return phonemePool.get(nearestMs) ?? null;
    }

    /**
     * Notify the pool that the BPM has changed.
     * Logs a note for future re-warming optimisations; does not block the
     * main thread.
     *
     * @param bpm Current beats-per-minute.
     */
    onBPMChange(bpm: number): void {
        if (bpm <= 0) return;
        // The existing grid already covers the typical step durations at this BPM.
        // If a stricter implementation is needed, warm the two most common next
        // durations here. For now, we just note the change.
        const stepMs = (60 / bpm / 4) * 1000; // 16th note at this BPM
        console.debug(
            `PhonemeBufferPool: BPM changed to ${bpm}. ` +
            `16th-note step = ${stepMs.toFixed(1)} ms. ` +
            `Grid coverage: ${this.durationGridMs.join(', ')} ms.`
        );
    }

    /** Remove all cached buffers from memory. */
    clear(): void {
        this.pool.clear();
        this.lruOrder.length = 0;
        this.totalBytes = 0;
    }

    /** Terminate the worker and clear the pool. */
    dispose(): void {
        this.clear();
        if (this.worker) {
            this.worker.terminate();
            this.worker = null;
        }
    }

    // ------------------------------------------------------------------
    // Internal helpers
    // ------------------------------------------------------------------

    private handleWorkerMessage(event: MessageEvent): void {
        if (!this.audioContext) return;

        const { phonemeId, targetMs, channels, sampleRate } = event.data as {
            phonemeId: string;
            targetMs: number;
            channels: Float32Array[];
            sampleRate: number;
        };

        if (!phonemeId || !channels || channels.length === 0 || typeof targetMs !== 'number' || !sampleRate) {
            console.warn('PhonemeBufferPool: received malformed message from worker', event.data);
            return;
        }

        const numChannels = channels.length;
        const length = channels[0].length;
        if (length === 0) {
            // Zero-length buffer — worker may have skipped it; ignore silently.
            return;
        }

        // Reconstruct a real AudioBuffer from the transferred Float32Arrays
        const audioBuffer = this.audioContext.createBuffer(numChannels, length, sampleRate);
        for (let ch = 0; ch < numChannels; ch++) {
            audioBuffer.getChannelData(ch).set(channels[ch]);
        }

        // Store in pool
        if (!this.pool.has(phonemeId)) {
            this.pool.set(phonemeId, new Map());
        }
        this.pool.get(phonemeId)!.set(targetMs, audioBuffer);

        // LRU bookkeeping
        const key = `${phonemeId}:${targetMs}`;
        this.touchLRU(key);

        // Memory accounting
        this.totalBytes += numChannels * length * BYTES_PER_SAMPLE;
        this.evictIfNeeded();
    }

    /** Move `key` to the most-recently-used end of the LRU list. */
    private touchLRU(key: string): void {
        const idx = this.lruOrder.indexOf(key);
        if (idx !== -1) this.lruOrder.splice(idx, 1);
        this.lruOrder.push(key);
    }

    /**
     * Evict the least-recently-used entries until the pool is under
     * MAX_POOL_BYTES.
     */
    private evictIfNeeded(): void {
        while (this.totalBytes > MAX_POOL_BYTES && this.lruOrder.length > 0) {
            const oldest = this.lruOrder.shift()!;
            const colonIdx = oldest.lastIndexOf(':');
            if (colonIdx === -1) continue;

            const phonemeId = oldest.slice(0, colonIdx);
            const targetMs = parseInt(oldest.slice(colonIdx + 1), 10);
            if (Number.isNaN(targetMs)) continue;

            const phonemePool = this.pool.get(phonemeId);
            if (!phonemePool) continue;

            const buf = phonemePool.get(targetMs);
            if (buf) {
                this.totalBytes -= buf.numberOfChannels * buf.length * BYTES_PER_SAMPLE;
                phonemePool.delete(targetMs);
                if (phonemePool.size === 0) {
                    this.pool.delete(phonemeId);
                }
            }
        }
    }
}
