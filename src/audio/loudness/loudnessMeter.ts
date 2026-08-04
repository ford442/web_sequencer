/**
 * BS.1770-5 loudness meter: momentary (400 ms), short-term (3 s) and gated
 * integrated loudness, plus sample-peak and true-peak.
 *
 * Real-time constraints honoured throughout:
 *  - every buffer is allocated in the constructor; `process()` allocates nothing
 *  - all power accumulation is Float64
 *  - integrated loudness uses a fixed-size histogram (libebur128's approach)
 *    rather than a growing list of block powers, so an all-day session cannot
 *    grow the worklet's memory
 *  - non-finite input is coerced to silence so a NaN upstream cannot latch the
 *    meter or the limiter that reads it
 */

import { KWeightingFilter } from './kWeighting';
import { TruePeakDetector, linearToDb } from './truePeak';
import { SILENCE_LUFS } from './types';

/** BS.1770 loudness offset. */
const LUFS_OFFSET = -0.691;

/** Sub-block hop: 100 ms gives the 75 %-overlapped 400 ms gating blocks. */
const SUB_BLOCK_SECONDS = 0.1;
/** Momentary window = 4 sub-blocks. */
const MOMENTARY_SUB_BLOCKS = 4;
/** Short-term window = 30 sub-blocks. */
const SHORT_TERM_SUB_BLOCKS = 30;

/** Absolute gate (LUFS) from BS.1770-4 onwards. */
const ABSOLUTE_GATE_LUFS = -70;
/** Relative gate, in LU below the ungated mean. */
const RELATIVE_GATE_LU = -10;

/** Histogram covering [-70, +30) LUFS in 0.1 LU bins. */
const HIST_MIN_LUFS = ABSOLUTE_GATE_LUFS;
const HIST_BIN_LU = 0.1;
const HIST_BINS = 1000;

/** Mean square → loudness in LUFS. */
export function meanSquareToLufs(meanSquare: number): number {
    if (!(meanSquare > 0) || !Number.isFinite(meanSquare)) return SILENCE_LUFS;
    return LUFS_OFFSET + 10 * Math.log10(meanSquare);
}

export interface LoudnessMeterOptions {
    sampleRate: number;
    channelCount?: number;
    /** BS.1770 channel weights; defaults to 1.0 for every channel (L/R/C). */
    channelWeights?: readonly number[];
    /** Override the true-peak oversampling factor (offline renders may use 8×). */
    truePeakFactor?: number;
}

export class LoudnessMeter {
    readonly sampleRate: number;
    readonly channelCount: number;

    private readonly weights: Float64Array;
    private readonly filters: KWeightingFilter[];
    private readonly truePeakDetectors: TruePeakDetector[];

    /** Frames per 100 ms sub-block, recomputed from the live sample rate. */
    private readonly subBlockFrames: number;
    /** Ring of per-sub-block weighted sums of squares. */
    private readonly subBlockPower: Float64Array;
    private subBlockCount = 0;
    private subBlockWrite = 0;

    /** Accumulator for the sub-block currently being filled. */
    private pendingPower = 0;
    private pendingFrames = 0;

    /** Gating histogram: per-bin block count and summed mean-square. */
    private readonly histogramCounts: Int32Array;
    private readonly histogramPower: Float64Array;
    private gatedBlockCount = 0;

    private samplePeakLinear = 0;

    constructor(options: LoudnessMeterOptions) {
        const { sampleRate, channelCount = 2, channelWeights, truePeakFactor } = options;
        this.sampleRate = sampleRate;
        this.channelCount = channelCount;

        this.weights = new Float64Array(channelCount);
        for (let ch = 0; ch < channelCount; ch += 1) {
            this.weights[ch] = channelWeights?.[ch] ?? 1.0;
        }

        this.filters = [];
        this.truePeakDetectors = [];
        for (let ch = 0; ch < channelCount; ch += 1) {
            this.filters.push(new KWeightingFilter(sampleRate));
            this.truePeakDetectors.push(new TruePeakDetector(sampleRate, truePeakFactor));
        }

        this.subBlockFrames = Math.max(1, Math.round(sampleRate * SUB_BLOCK_SECONDS));
        this.subBlockPower = new Float64Array(SHORT_TERM_SUB_BLOCKS);
        this.histogramCounts = new Int32Array(HIST_BINS);
        this.histogramPower = new Float64Array(HIST_BINS);
    }

    /** Clear everything, including the integrated measurement. */
    reset(): void {
        for (const filter of this.filters) filter.reset();
        for (const detector of this.truePeakDetectors) detector.reset();
        this.subBlockPower.fill(0);
        this.subBlockCount = 0;
        this.subBlockWrite = 0;
        this.pendingPower = 0;
        this.pendingFrames = 0;
        this.histogramCounts.fill(0);
        this.histogramPower.fill(0);
        this.gatedBlockCount = 0;
        this.samplePeakLinear = 0;
    }

    /**
     * Reset only the gated integrated measurement.
     * Momentary/short-term keep running so the UI does not blink.
     */
    resetIntegrated(): void {
        this.histogramCounts.fill(0);
        this.histogramPower.fill(0);
        this.gatedBlockCount = 0;
    }

    /** Clear held peaks (sample and true peak) without touching loudness state. */
    resetPeaks(): void {
        this.samplePeakLinear = 0;
        for (const detector of this.truePeakDetectors) detector.resetPeak();
    }

    /**
     * Consume `frames` of audio. `channels[ch]` must hold at least `frames`
     * samples. Extra channels beyond `channelCount` are ignored; missing
     * channels are treated as silence.
     */
    process(channels: readonly Float32Array[], frames: number): void {
        for (let i = 0; i < frames; i += 1) {
            let weighted = 0;
            for (let ch = 0; ch < this.channelCount; ch += 1) {
                const source = channels[ch];
                const raw = source !== undefined ? source[i] : 0;
                const sample = Number.isFinite(raw) ? raw : 0;

                const magnitude = sample < 0 ? -sample : sample;
                if (magnitude > this.samplePeakLinear) this.samplePeakLinear = magnitude;
                this.truePeakDetectors[ch].processSample(sample);

                const filtered = this.filters[ch].process(sample);
                weighted += this.weights[ch] * filtered * filtered;
            }

            this.pendingPower += weighted;
            this.pendingFrames += 1;
            if (this.pendingFrames >= this.subBlockFrames) {
                this.commitSubBlock();
            }
        }
    }

    private commitSubBlock(): void {
        this.subBlockPower[this.subBlockWrite] = this.pendingPower;
        this.subBlockWrite = (this.subBlockWrite + 1) % SHORT_TERM_SUB_BLOCKS;
        this.subBlockCount += 1;
        this.pendingPower = 0;
        this.pendingFrames = 0;

        if (this.subBlockCount >= MOMENTARY_SUB_BLOCKS) {
            this.accumulateGatingBlock(this.windowMeanSquare(MOMENTARY_SUB_BLOCKS));
        }
    }

    /** Mean square over the most recent `count` sub-blocks. */
    private windowMeanSquare(count: number): number {
        const available = Math.min(count, this.subBlockCount, SHORT_TERM_SUB_BLOCKS);
        if (available <= 0) return 0;
        let sum = 0;
        for (let n = 1; n <= available; n += 1) {
            const index = (this.subBlockWrite - n + SHORT_TERM_SUB_BLOCKS) % SHORT_TERM_SUB_BLOCKS;
            sum += this.subBlockPower[index];
        }
        return sum / (available * this.subBlockFrames);
    }

    /** Add a completed 400 ms gating block to the histogram (absolute gate applied). */
    private accumulateGatingBlock(meanSquare: number): void {
        const loudness = meanSquareToLufs(meanSquare);
        if (!(loudness > ABSOLUTE_GATE_LUFS)) return;
        let bin = Math.floor((loudness - HIST_MIN_LUFS) / HIST_BIN_LU);
        if (bin < 0) bin = 0;
        if (bin >= HIST_BINS) bin = HIST_BINS - 1;
        this.histogramCounts[bin] += 1;
        this.histogramPower[bin] += meanSquare;
        this.gatedBlockCount += 1;
    }

    /** Momentary loudness (400 ms), LUFS. */
    get momentary(): number {
        if (this.subBlockCount < MOMENTARY_SUB_BLOCKS) return SILENCE_LUFS;
        return meanSquareToLufs(this.windowMeanSquare(MOMENTARY_SUB_BLOCKS));
    }

    /** Short-term loudness (3 s), LUFS. */
    get shortTerm(): number {
        if (this.subBlockCount < SHORT_TERM_SUB_BLOCKS) return SILENCE_LUFS;
        return meanSquareToLufs(this.windowMeanSquare(SHORT_TERM_SUB_BLOCKS));
    }

    /** Gated integrated loudness since the last integrated reset, LUFS. */
    get integrated(): number {
        if (this.gatedBlockCount === 0) return SILENCE_LUFS;

        let count = 0;
        let power = 0;
        for (let bin = 0; bin < HIST_BINS; bin += 1) {
            count += this.histogramCounts[bin];
            power += this.histogramPower[bin];
        }
        if (count === 0) return SILENCE_LUFS;

        const relativeThreshold = meanSquareToLufs(power / count) + RELATIVE_GATE_LU;
        if (!Number.isFinite(relativeThreshold)) return SILENCE_LUFS;

        const firstBin = Math.max(
            0,
            Math.ceil((relativeThreshold - HIST_MIN_LUFS) / HIST_BIN_LU),
        );
        let gatedCount = 0;
        let gatedPower = 0;
        for (let bin = firstBin; bin < HIST_BINS; bin += 1) {
            gatedCount += this.histogramCounts[bin];
            gatedPower += this.histogramPower[bin];
        }
        if (gatedCount === 0) return SILENCE_LUFS;
        return meanSquareToLufs(gatedPower / gatedCount);
    }

    /** Held sample peak, dBFS. */
    get samplePeakDb(): number {
        return linearToDb(this.samplePeakLinear);
    }

    /** Held true peak, dBTP. */
    get truePeakDb(): number {
        let peak = 0;
        for (const detector of this.truePeakDetectors) {
            if (detector.peak > peak) peak = detector.peak;
        }
        return linearToDb(peak);
    }
}
