// useLevelMeter — reads RMS amplitude and peak hold from a Web Audio AnalyserNode.
//
// Design:
// - Runs a requestAnimationFrame loop while mounted.
// - Returns a stable object reference whose `.level` and `.peak` properties are
//   mutated in-place each frame so callers can read them from refs without
//   triggering React re-renders (ideal for canvas drawing loops).
// - The `subscribe` callback is called each frame so canvas components can
//   schedule their own draw without separate rAF loops.
//
// Peak hold: peak decays at `peakDecayPerFrame` per frame (~0.001 @ 60fps = 6%/s).

import { useEffect, useRef } from 'react';

export interface LevelReading {
    /** RMS level, 0–1. */
    level: number;
    /** Peak hold, 0–1 (decays slowly). */
    peak: number;
}

export interface UseLevelMeterOptions {
    /** How quickly peak hold falls each animation frame. Default 0.003. */
    peakDecayPerFrame?: number;
    /** Optional frame callback — called each frame with the current reading. */
    onFrame?: (reading: LevelReading) => void;
}

export function useLevelMeter(
    analyserNode: AnalyserNode | null | undefined,
    options: UseLevelMeterOptions = {},
): LevelReading {
    const { peakDecayPerFrame = 0.003, onFrame } = options;

    // Stable reading object — mutated in-place each frame.
    const reading = useRef<LevelReading>({ level: 0, peak: 0 }).current;

    const rafRef = useRef<number | null>(null);
    const dataRef = useRef<Float32Array | null>(null);
    const onFrameRef = useRef(onFrame);
    useEffect(() => { onFrameRef.current = onFrame; }, [onFrame]);

    useEffect(() => {
        if (!analyserNode) return;

        // Allocate buffer once; resize if fftSize changes.
        dataRef.current = new Float32Array(analyserNode.fftSize);

        const tick = () => {
            if (!analyserNode || !dataRef.current) return;
            if (dataRef.current.length !== analyserNode.fftSize) {
                dataRef.current = new Float32Array(analyserNode.fftSize);
            }

            analyserNode.getFloatTimeDomainData(dataRef.current as Float32Array<ArrayBuffer>);
            reading.level = computeRms(dataRef.current);
            reading.peak = Math.max(reading.level, reading.peak - peakDecayPerFrame);

            onFrameRef.current?.(reading);
            rafRef.current = requestAnimationFrame(tick);
        };

        rafRef.current = requestAnimationFrame(tick);
        return () => {
            if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
        };
    }, [analyserNode, peakDecayPerFrame, reading]);

    return reading;
}

// ── Pure helper (exported for testing) ────────────────────────────────────────

/**
 * Compute RMS amplitude of a Float32Array of PCM samples.
 * Returns a value in [0, 1] (assumes samples are in the –1…+1 range).
 */
export function computeRms(samples: Float32Array | Float32Array<ArrayBufferLike>): number {
    if (samples.length === 0) return 0;
    let sum = 0;
    for (let i = 0; i < samples.length; i++) {
        sum += samples[i]! * samples[i]!;
    }
    return Math.sqrt(sum / samples.length);
}
