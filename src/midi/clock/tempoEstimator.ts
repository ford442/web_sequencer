import { BPM_MAX, BPM_MIN, MIDI_PPQN } from './types';

/** Period bounds derived from BPM range (ms between clock ticks). */
const MIN_TICK_MS = (60_000 / BPM_MAX) / MIDI_PPQN;
const MAX_TICK_MS = (60_000 / BPM_MIN) / MIDI_PPQN;

/** EMA smoothing factor for inter-tick period (lower = smoother). */
const PERIOD_EMA_ALPHA = 0.15;

const JITTER_HISTORY = 32;

export interface TempoEstimatorSnapshot {
  measuredBpm: number | null;
  phaseErrorMs: number;
  jitterMs: number;
  droppedClocks: number;
  periodMs: number | null;
}

/**
 * Bounded PLL / tempo estimator over DOMHighResTimeStamp clock intervals.
 */
export class TempoEstimator {
  private lastDom: number | null = null;
  private periodMs: number | null = null;
  private phaseErrorMs = 0;
  private droppedClocks = 0;
  private jitterSamples: number[] = [];

  reset(): void {
    this.lastDom = null;
    this.periodMs = null;
    this.phaseErrorMs = 0;
    this.droppedClocks = 0;
    this.jitterSamples = [];
  }

  /** Feed a clock tick timestamp; returns whether the interval was accepted. */
  observeClock(domTime: number): boolean {
    if (this.lastDom == null) {
      this.lastDom = domTime;
      return true;
    }

    const interval = domTime - this.lastDom;
    this.lastDom = domTime;

    if (interval <= 0 || interval < MIN_TICK_MS * 0.5 || interval > MAX_TICK_MS * 2) {
      this.droppedClocks++;
      return false;
    }

    const expected = this.periodMs ?? interval;
    this.phaseErrorMs = interval - expected;

    if (interval >= MIN_TICK_MS && interval <= MAX_TICK_MS) {
      if (this.periodMs == null) {
        this.periodMs = interval;
      } else {
        this.periodMs =
          PERIOD_EMA_ALPHA * interval + (1 - PERIOD_EMA_ALPHA) * this.periodMs;
      }

      const jitter = Math.abs(interval - this.periodMs);
      this.jitterSamples.push(jitter);
      if (this.jitterSamples.length > JITTER_HISTORY) this.jitterSamples.shift();
    } else {
      this.droppedClocks++;
      return false;
    }

    return true;
  }

  /** Predict next clock tick DOM time from the last observed tick. */
  predictNextDom(): number | null {
    if (this.lastDom == null || this.periodMs == null) return null;
    return this.lastDom + this.periodMs;
  }

  getSnapshot(): TempoEstimatorSnapshot {
    const measuredBpm =
      this.periodMs != null && this.periodMs > 0
        ? 60_000 / (this.periodMs * MIDI_PPQN)
        : null;

    return {
      measuredBpm,
      phaseErrorMs: this.phaseErrorMs,
      jitterMs: percentile(this.jitterSamples, 95) ?? 0,
      droppedClocks: this.droppedClocks,
      periodMs: this.periodMs,
    };
  }

  seedPeriodFromBpm(bpm: number): void {
    const clamped = Math.max(BPM_MIN, Math.min(BPM_MAX, bpm));
    this.periodMs = (60_000 / clamped) / MIDI_PPQN;
  }
}

function percentile(arr: number[], p: number): number | null {
  if (arr.length === 0) return null;
  const sorted = arr.slice().sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * (sorted.length - 1)));
  return sorted[idx] ?? null;
}
