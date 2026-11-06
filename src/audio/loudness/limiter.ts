/**
 * True-peak aware brick-wall limiter for the master bus.
 *
 * Signal flow per sample:
 *   1. a polyphase true-peak detector estimates the inter-sample magnitude,
 *   2. the required gain (ceiling / peak) is pushed into a sliding-minimum
 *      window covering the lookahead, so the gain is already down when the
 *      transient arrives,
 *   3. the sliding minimum is smoothed with attack/release one-poles,
 *   4. the smoothed gain multiplies the delayed audio, and a final clamp at the
 *      ceiling guarantees the brick wall even if the smoother lags.
 *
 * Latency is `lookahead + detector group delay` and is reported through
 * `latencySeconds` for the engine's monitor-latency accounting.
 *
 * All buffers are sized for `MAX_LOOKAHEAD_MS` at construction: changing the
 * lookahead at runtime re-slices existing storage and never allocates, and
 * `process()` allocates nothing at all.
 */

import {
    TruePeakDetector,
    TAPS_PER_PHASE,
    dbToLinear,
    linearToDb,
    oversamplingFactorFor,
} from './truePeak';
import { DEFAULT_LIMITER_SETTINGS, type LimiterSettings } from './types';

/** Upper bound on lookahead — fixes the size of the preallocated delay lines. */
export const MAX_LOOKAHEAD_MS = 10;

/**
 * Headroom the gain computation keeps below the user's ceiling, in dB.
 *
 * Two effects push the output above a naively computed ceiling (0.4 dB covers
 * both, verified against an 8× offline measurement in the tests): oversampled ISP
 * estimation still underestimates near-Nyquist content, and applying a
 * time-varying gain creates inter-sample energy of its own. Targeting slightly
 * under the ceiling keeps the brick wall intact when the file is measured by a
 * stricter meter, at a cost far below the audible threshold.
 */
const DETECTION_HEADROOM_DB = 0.4;

/** Group delay of the polyphase true-peak detector, in input samples. */
const DETECTOR_LATENCY_FRAMES = TAPS_PER_PHASE >> 1;

function clamp(value: number, min: number, max: number): number {
    return value < min ? min : value > max ? max : value;
}

/** One-pole coefficient for a time constant in samples (1 = instantaneous). */
function onePoleCoefficient(timeFrames: number): number {
    if (!(timeFrames > 0)) return 1;
    return 1 - Math.exp(-1 / timeFrames);
}

export class TruePeakLimiter {
    readonly sampleRate: number;
    readonly channelCount: number;

    private settings: LimiterSettings;

    private readonly detectors: TruePeakDetector[];
    /** Per-channel delay lines, sized for max lookahead + detector delay + one quantum. */
    private readonly delayLines: Float32Array[];
    private readonly delayCapacity: number;
    private delayWrite = 0;
    private delayFrames: number;

    /** Monotonic deque for the sliding minimum of the target gain. */
    private readonly maxLookaheadFrames: number;
    private readonly dequeCapacity: number;
    private readonly dequeIndices: Int32Array;
    private readonly dequeValues: Float64Array;
    private dequeHead = 0;
    private dequeTail = 0;
    private sampleCounter = 0;
    private lookaheadFrames: number;

    private currentGain = 1;
    private attackCoefficient = 1;
    private releaseCoefficient = 1;
    /** Hard wall applied to the output samples. */
    private ceilingLinear: number;
    /** Slightly lower target used to compute gain — see DETECTION_HEADROOM_DB. */
    private targetCeilingLinear: number;

    /** Minimum gain applied since the last `takeStats()`, linear. */
    private minGainSinceReport = 1;
    private clippedSinceReport = false;
    private readonly statsResult = { gainReductionDb: 0, clipped: false };

    constructor(sampleRate: number, channelCount = 2, settings?: Partial<LimiterSettings>) {
        this.sampleRate = sampleRate;
        this.channelCount = channelCount;
        this.settings = { ...DEFAULT_LIMITER_SETTINGS, ...settings };

        const maxLookahead = Math.ceil((MAX_LOOKAHEAD_MS / 1000) * sampleRate);
        this.delayCapacity = maxLookahead + DETECTOR_LATENCY_FRAMES + 1;
        this.delayLines = [];
        for (let ch = 0; ch < channelCount; ch += 1) {
            this.delayLines.push(new Float32Array(this.delayCapacity));
        }
        this.detectors = [];
        for (let ch = 0; ch < channelCount; ch += 1) {
            // The limiter detects at twice the metering factor: 4× ISP
            // estimation underestimates near-Nyquist transients badly enough to
            // break the brick wall, and one stereo pair can afford the taps.
            const oversample = this.settings.detectOversample ?? Math.min(8, oversamplingFactorFor(sampleRate) * 2);
            this.detectors.push(
                new TruePeakDetector(sampleRate, oversample),
            );
        }

        this.maxLookaheadFrames = maxLookahead;
        // +2 so a strictly increasing full window still fits with head !== tail.
        this.dequeCapacity = maxLookahead + 2;
        this.dequeIndices = new Int32Array(this.dequeCapacity);
        this.dequeValues = new Float64Array(this.dequeCapacity);

        this.lookaheadFrames = 0;
        this.delayFrames = 0;
        this.ceilingLinear = dbToLinear(this.settings.ceilingDbtp);
        this.targetCeilingLinear = this.ceilingLinear;
        this.applySettings();
    }

    /** Current settings (copy — callers must not mutate limiter state directly). */
    getSettings(): LimiterSettings {
        return { ...this.settings };
    }

    /** Merge a partial settings update. Safe to call between render quanta. */
    setSettings(update: Partial<LimiterSettings>): void {
        const previousLookahead = this.lookaheadFrames;
        this.settings = { ...this.settings, ...update };
        this.applySettings();
        if (this.lookaheadFrames !== previousLookahead) {
            this.flush();
        }
    }

    private applySettings(): void {
        const requested = this.settings.monitorOnly
            ? 0
            : Math.round((clamp(this.settings.lookaheadMs, 0, MAX_LOOKAHEAD_MS) / 1000) * this.sampleRate);
        this.lookaheadFrames = clamp(requested, 0, this.maxLookaheadFrames);
        this.delayFrames =
            this.settings.monitorOnly || !this.settings.enabled
                ? 0
                : this.lookaheadFrames + DETECTOR_LATENCY_FRAMES;

        const ceilingDbtp = clamp(this.settings.ceilingDbtp, -24, 0);
        this.ceilingLinear = dbToLinear(ceilingDbtp);
        this.targetCeilingLinear = dbToLinear(ceilingDbtp - DETECTION_HEADROOM_DB);

        // The gain must be able to reach its target within the lookahead window,
        // otherwise the brick wall would be enforced by the safety clamp alone.
        const attackFrames = Math.min(
            (clamp(this.settings.attackMs, 0.01, 100) / 1000) * this.sampleRate,
            Math.max(1, this.lookaheadFrames),
        );
        this.attackCoefficient = onePoleCoefficient(attackFrames);
        this.releaseCoefficient = onePoleCoefficient(
            (clamp(this.settings.releaseMs, 1, 5000) / 1000) * this.sampleRate,
        );
    }

    /** Added monitor latency in seconds. */
    get latencySeconds(): number {
        return this.delayFrames / this.sampleRate;
    }

    /** Clear delay lines, detectors and gain state. */
    flush(): void {
        for (const line of this.delayLines) line.fill(0);
        for (const detector of this.detectors) detector.reset();
        this.delayWrite = 0;
        this.dequeHead = 0;
        this.dequeTail = 0;
        this.sampleCounter = 0;
        this.currentGain = 1;
    }

    /**
     * Gain reduction (dB, ≤ 0) and clip flag since the previous call.
     * Reading resets the accumulators so the UI sees per-report extremes.
     */
    takeStats(): { gainReductionDb: number; clipped: boolean } {
        this.statsResult.gainReductionDb = this.minGainSinceReport >= 1 ? 0 : linearToDb(this.minGainSinceReport);
        this.statsResult.clipped = this.clippedSinceReport;
        this.minGainSinceReport = 1;
        this.clippedSinceReport = false;
        return this.statsResult;
    }

    /**
     * Limit `frames` samples. `input` and `output` may be the same arrays.
     * Channels beyond `channelCount` are copied through untouched by the caller.
     */
    process(input: readonly Float32Array[], output: Float32Array[], frames: number): void {
        if (!this.settings.enabled) {
            this.passThrough(input, output, frames);
            return;
        }
        if (this.settings.monitorOnly) {
            this.hardClip(input, output, frames);
            return;
        }

        const ceiling = this.ceilingLinear;
        const target = this.targetCeilingLinear;
        const capacity = this.dequeCapacity;

        const channelCount = this.channelCount;
        const detectors = this.detectors;
        const delayLines = this.delayLines;

        let localDelayWrite = this.delayWrite;
        let localSampleCounter = this.sampleCounter;
        let localCurrentGain = this.currentGain;
        let localMinGainSinceReport = this.minGainSinceReport;
        let localClippedSinceReport = this.clippedSinceReport;

        const attackCoefficient = this.attackCoefficient;
        const releaseCoefficient = this.releaseCoefficient;
        const delayFrames = this.delayFrames;
        const delayCapacity = this.delayCapacity;

        if (channelCount === 2) {
            const in0 = input[0];
            const in1 = input[1];
            const out0 = output[0];
            const out1 = output[1];
            const det0 = detectors[0];
            const det1 = detectors[1];
            const del0 = delayLines[0];
            const del1 = delayLines[1];

            let dTail = this.dequeTail;
            let dHead = this.dequeHead;
            const dVals = this.dequeValues;
            const dInd = this.dequeIndices;

            for (let i = 0; i < frames; i += 1) {
                let peak = 0;

                const raw0 = in0 !== undefined ? in0[i] : 0;
                const sample0 = raw0 === raw0 && raw0 > -Infinity && raw0 < Infinity ? raw0 : 0;
                const detected0 = det0.processSample(sample0);
                if (detected0 > peak) peak = detected0;
                del0[localDelayWrite] = sample0;

                const raw1 = in1 !== undefined ? in1[i] : 0;
                const sample1 = raw1 === raw1 && raw1 > -Infinity && raw1 < Infinity ? raw1 : 0;
                const detected1 = det1.processSample(sample1);
                if (detected1 > peak) peak = detected1;
                del1[localDelayWrite] = sample1;

                const gainTarget = peak > target ? target / peak : 1;
                const index = localSampleCounter;

                while (dTail > dHead && dVals[(dTail - 1) % capacity] >= gainTarget) {
                    dTail -= 1;
                }
                const idx = dTail % capacity;
                dVals[idx] = gainTarget;
                dInd[idx] = index;
                dTail += 1;

                const threshold = index - delayFrames;
                while (dHead < dTail && dInd[dHead % capacity] < threshold) {
                    dHead += 1;
                }
                const windowMin = dHead < dTail ? dVals[dHead % capacity] : 1.0;

                const coefficient = windowMin < localCurrentGain ? attackCoefficient : releaseCoefficient;
                localCurrentGain += (windowMin - localCurrentGain) * coefficient;
                if (!(localCurrentGain === localCurrentGain)) localCurrentGain = 1;
                const gain = localCurrentGain < windowMin ? localCurrentGain : windowMin;
                if (gain < localMinGainSinceReport) localMinGainSinceReport = gain;

                const readIndex = localDelayWrite >= delayFrames ? localDelayWrite - delayFrames : localDelayWrite + delayCapacity - delayFrames;

                if (out0 !== undefined) {
                    let outSample0 = del0[readIndex] * gain;
                    if (outSample0 > ceiling) {
                        outSample0 = ceiling;
                        localClippedSinceReport = true;
                    } else if (outSample0 < -ceiling) {
                        outSample0 = -ceiling;
                        localClippedSinceReport = true;
                    }
                    out0[i] = outSample0;
                }

                if (out1 !== undefined) {
                    let outSample1 = del1[readIndex] * gain;
                    if (outSample1 > ceiling) {
                        outSample1 = ceiling;
                        localClippedSinceReport = true;
                    } else if (outSample1 < -ceiling) {
                        outSample1 = -ceiling;
                        localClippedSinceReport = true;
                    }
                    out1[i] = outSample1;
                }

                localDelayWrite = localDelayWrite === delayCapacity - 1 ? 0 : localDelayWrite + 1;
                localSampleCounter += 1;
            }

            this.dequeTail = dTail;
            this.dequeHead = dHead;
        } else {
            for (let i = 0; i < frames; i += 1) {
                // 1. Detect the inter-sample peak of this input frame (channel-linked).
                let peak = 0;
                for (let ch = 0; ch < channelCount; ch += 1) {
                    const source = input[ch];
                    const raw = source !== undefined ? source[i] : 0;
                    const sample = raw === raw && raw > -Infinity && raw < Infinity ? raw : 0;
                    const detected = detectors[ch].processSample(sample);
                    if (detected > peak) peak = detected;

                    // 2. Buffer the (undelayed) sample.
                    delayLines[ch][localDelayWrite] = sample;
                }

                const gainTarget = peak > target ? target / peak : 1;
                const index = localSampleCounter;
                this.pushSlidingMin(index, gainTarget, capacity);

                // 3. The minimum gain over [index - lookahead, index] applies to the
                //    sample leaving the delay line now.
                const windowMin = this.slidingMin(index, capacity);
                const coefficient =
                    windowMin < localCurrentGain ? attackCoefficient : releaseCoefficient;
                localCurrentGain += (windowMin - localCurrentGain) * coefficient;
                if (!(localCurrentGain === localCurrentGain)) localCurrentGain = 1;
                const gain = localCurrentGain < windowMin ? localCurrentGain : windowMin;
                if (gain < localMinGainSinceReport) localMinGainSinceReport = gain;

                // 4. Emit the delayed sample with the gain, clamped to the ceiling.
                const readIndex =
                    localDelayWrite >= delayFrames
                        ? localDelayWrite - delayFrames
                        : localDelayWrite + delayCapacity - delayFrames;
                for (let ch = 0; ch < channelCount; ch += 1) {
                    const out = output[ch];
                    if (out === undefined) continue;
                    let value = delayLines[ch][readIndex] * gain;
                    if (value > ceiling) {
                        value = ceiling;
                        localClippedSinceReport = true;
                    } else if (value < -ceiling) {
                        value = -ceiling;
                        localClippedSinceReport = true;
                    }
                    out[i] = value;
                }

                localDelayWrite = localDelayWrite === delayCapacity - 1 ? 0 : localDelayWrite + 1;
                localSampleCounter = index + 1;
            }
        }

        this.delayWrite = localDelayWrite;
        this.sampleCounter = localSampleCounter;
        this.currentGain = localCurrentGain;
        this.minGainSinceReport = localMinGainSinceReport;
        this.clippedSinceReport = localClippedSinceReport;
    }

    /** Monotonic deque push — keeps indices of increasing gains. */
    private pushSlidingMin(index: number, value: number, capacity: number): void {
        while (
            this.dequeTail !== this.dequeHead &&
            this.dequeValues[(this.dequeTail - 1 + capacity) % capacity] >= value
        ) {
            this.dequeTail = (this.dequeTail - 1 + capacity) % capacity;
        }
        this.dequeIndices[this.dequeTail] = index;
        this.dequeValues[this.dequeTail] = value;
        this.dequeTail = (this.dequeTail + 1) % capacity;
    }

    /** Minimum gain over the last `lookaheadFrames + 1` pushed targets. */
    private slidingMin(index: number, capacity: number): number {
        const oldest = index - this.lookaheadFrames;
        while (this.dequeHead !== this.dequeTail && this.dequeIndices[this.dequeHead] < oldest) {
            this.dequeHead = (this.dequeHead + 1) % capacity;
        }
        return this.dequeHead === this.dequeTail ? 1 : this.dequeValues[this.dequeHead];
    }

    private passThrough(input: readonly Float32Array[], output: Float32Array[], frames: number): void {
        for (let ch = 0; ch < this.channelCount; ch += 1) {
            const source = input[ch];
            const out = output[ch];
            if (out === undefined) continue;
            for (let i = 0; i < frames; i += 1) {
                const raw = source !== undefined ? source[i] : 0;
                out[i] = Number.isFinite(raw) ? raw : 0;
            }
        }
    }

    /** Zero-latency safety mode for live monitoring: sample-domain hard clip. */
    private hardClip(input: readonly Float32Array[], output: Float32Array[], frames: number): void {
        const ceiling = this.ceilingLinear;
        let minGain = 1;
        for (let ch = 0; ch < this.channelCount; ch += 1) {
            const source = input[ch];
            const out = output[ch];
            if (out === undefined) continue;
            for (let i = 0; i < frames; i += 1) {
                const raw = source !== undefined ? source[i] : 0;
                const sample = Number.isFinite(raw) ? raw : 0;
                const magnitude = sample < 0 ? -sample : sample;
                if (magnitude > ceiling) {
                    this.clippedSinceReport = true;
                    const gain = ceiling / magnitude;
                    if (gain < minGain) minGain = gain;
                    out[i] = sample < 0 ? -ceiling : ceiling;
                } else {
                    out[i] = sample;
                }
            }
        }
        if (minGain < this.minGainSinceReport) this.minGainSinceReport = minGain;
        this.currentGain = 1;
    }
}
