// src/workers/PhonemeStretchWorker.ts
// Web Worker: offline phoneme time-stretching via OLA (Overlap-Add).
// Runs in a dedicated worker thread so the main thread and audio scheduler
// are never blocked by DSP computation.

/** Minimum allowed stretch ratio — below this Rubber Band / OLA produce garbage */
export const STRETCH_RATIO_MIN = 0.1;
/** Maximum allowed stretch ratio */
export const STRETCH_RATIO_MAX = 8.0;

/**
 * Clamp a stretch ratio to the safe range [STRETCH_RATIO_MIN, STRETCH_RATIO_MAX].
 * Emits console.warn (not console.error) for out-of-range values per spec.
 */
export function clampStretchRatio(ratio: number): number {
    if (ratio < STRETCH_RATIO_MIN) {
        console.warn(
            `PhonemeStretchWorker: stretch ratio ${ratio.toFixed(4)} is below minimum ` +
            `${STRETCH_RATIO_MIN} — clamping.`
        );
        return STRETCH_RATIO_MIN;
    }
    if (ratio > STRETCH_RATIO_MAX) {
        console.warn(
            `PhonemeStretchWorker: stretch ratio ${ratio.toFixed(4)} exceeds maximum ` +
            `${STRETCH_RATIO_MAX} — clamping.`
        );
        return STRETCH_RATIO_MAX;
    }
    return ratio;
}

/**
 * Apply a normalised Hann window to a frame array in-place.
 */
function applyHannWindow(frame: Float32Array): void {
    const N = frame.length;
    if (N < 2) return;
    for (let i = 0; i < N; i++) {
        frame[i] *= 0.5 * (1.0 - Math.cos((2.0 * Math.PI * i) / (N - 1)));
    }
}

/**
 * Pitch-preserving time stretch using the Overlap-Add (OLA) algorithm.
 *
 * OLA is appropriate for short phoneme slices (50–400 ms) where phase
 * coherence across frames is not critical.  For longer segments a WSOLA
 * or phase-vocoder approach would be preferable, but OLA is sufficient
 * here and requires no external dependencies.
 *
 * @param input    Mono input signal
 * @param ratio    Output duration / input duration  (e.g. 1.5 = 50% longer)
 * @param frameSize Analysis/synthesis frame size in samples (default 512)
 * @returns New Float32Array containing the time-stretched signal
 */
export function olaStretch(input: Float32Array, ratio: number, frameSize: number = 512): Float32Array {
    const hopSize = Math.floor(frameSize / 2);            // 50% overlap-add
    const synthHop = Math.round(hopSize * ratio);          // output frame spacing
    const outputLength = Math.max(1, Math.ceil(input.length * ratio));

    const output = new Float32Array(outputLength);
    const normAcc = new Float32Array(outputLength);        // window accumulator for normalisation

    // Pre-compute Hann coefficients for the accumulator contribution
    const hannCoeffs = new Float32Array(frameSize);
    for (let i = 0; i < frameSize; i++) {
        hannCoeffs[i] = 0.5 * (1.0 - Math.cos((2.0 * Math.PI * i) / (frameSize - 1)));
    }

    let inputPos = 0;
    let outputPos = 0;

    while (inputPos + frameSize <= input.length && outputPos < outputLength) {
        // Extract and window the analysis frame
        const frame = new Float32Array(frameSize);
        for (let i = 0; i < frameSize; i++) {
            frame[i] = input[inputPos + i];
        }
        applyHannWindow(frame);

        // Overlap-add into output
        const writeEnd = Math.min(outputPos + frameSize, outputLength);
        for (let i = outputPos, fi = 0; i < writeEnd; i++, fi++) {
            output[i] += frame[fi];
            normAcc[i] += hannCoeffs[fi];
        }

        inputPos += hopSize;
        outputPos += synthHop;
    }

    // Normalise to avoid gain reduction / clipping from OLA overlap
    for (let i = 0; i < outputLength; i++) {
        if (normAcc[i] > 1e-6) {
            output[i] /= normAcc[i];
        }
    }

    return output;
}

// ---------------------------------------------------------------------------
// Worker message handler
// ---------------------------------------------------------------------------

/**
 * Incoming message shape sent by PhonemeBufferPool.warmPhoneme():
 * {
 *   phonemeId:       string          — stable ID for this phoneme slice
 *   channels:        Float32Array[]  — per-channel audio (transferred)
 *   sampleRate:      number          — audio sample rate in Hz
 *   targetDurations: number[]        — target durations in SECONDS
 * }
 *
 * For each targetDuration the worker posts back:
 * {
 *   phonemeId:  string
 *   targetMs:   number          — targetDuration × 1000, rounded to integer
 *   channels:   Float32Array[]  — stretched channel data (transferred)
 *   sampleRate: number
 *   done:       boolean         — true on the last duration in the batch
 * }
 */
self.onmessage = (event: MessageEvent): void => {
    const { phonemeId, channels, sampleRate, targetDurations } = event.data as {
        phonemeId: string;
        channels: Float32Array[];
        sampleRate: number;
        targetDurations: number[];
    };

    if (!channels || channels.length === 0 || !sampleRate || !targetDurations || !targetDurations.length) {
        console.warn('PhonemeStretchWorker: received invalid message — missing required fields.');
        return;
    }

    const nativeSamples = channels[0].length;
    const nativeDuration = nativeSamples / sampleRate;

    if (nativeDuration <= 0) {
        console.warn(
            `PhonemeStretchWorker: phoneme "${phonemeId}" has zero or negative native duration — skipping.`
        );
        return;
    }

    for (let di = 0; di < targetDurations.length; di++) {
        const targetDuration = targetDurations[di];
        const targetMs = Math.round(targetDuration * 1000);

        const rawRatio = targetDuration / nativeDuration;
        const stretchRatio = clampStretchRatio(rawRatio);

        const stretchedChannels: Float32Array[] = channels.map(ch =>
            olaStretch(ch, stretchRatio)
        );

        const isLast = di === targetDurations.length - 1;
        const transfers = stretchedChannels.map(c => c.buffer);

        self.postMessage(
            { phonemeId, targetMs, channels: stretchedChannels, sampleRate, done: isLast },
            // @ts-ignore — TypeScript does not expose the second arg on self.postMessage in all lib targets
            { transfer: transfers }
        );
    }
};
