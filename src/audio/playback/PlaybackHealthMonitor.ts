/**
 * Runtime instrumentation for sequencer/automation playback stability.
 * Tracks scheduler lag, voice steals, and automation back-pressure.
 */

import { engineDegradationStore } from '../../stores/engineDegradationStore';

/** Documented acceptable thresholds — see docs/audio-engine/PLAYBACK_STABILITY.md */
export const PLAYBACK_THRESHOLDS = {
  /** Warn when automation is applied later than this (ms behind audio clock). */
  schedulerLagWarnMs: 8,
  /** Force-immediate apply when lag exceeds this (ms). */
  schedulerLagDropMs: 32,
  /** Max pending worklet param callbacks before coalescing drops events. */
  maxPendingAutomation: 256,
  /** Voice steals per second before surfacing a degradation warning. */
  voiceStealWarnPerSec: 10,
  /** Minimum interval between duplicate step callbacks (ms). */
  stepDuplicateGuardMs: 4,
} as const;

export interface PlaybackHealthSnapshot {
  schedulerLagP95Ms: number | null;
  schedulerLagMaxMs: number;
  voiceSteals: number;
  backpressureEvents: number;
  stepBursts: number;
  lastWarningTs: number | null;
}

class PlaybackHealthMonitor {
  private schedulerLagSamples: number[] = [];
  private voiceSteals = 0;
  private voiceStealWindowStart = 0;
  private voiceStealsInWindow = 0;
  private backpressureEvents = 0;
  private stepBursts = 0;
  private lastWarningTs: number | null = null;
  private readonly maxLagSamples = 128;

  recordSchedulerLag(lagMs: number, _target?: string, _param?: string): void {
    if (lagMs <= 0) return;
    this.schedulerLagSamples.push(lagMs);
    if (this.schedulerLagSamples.length > this.maxLagSamples) {
      this.schedulerLagSamples.shift();
    }
    if (lagMs >= PLAYBACK_THRESHOLDS.schedulerLagWarnMs) {
      this.maybeWarn(
        `Automation scheduler ${lagMs.toFixed(1)}ms behind audio clock`,
      );
    }
  }

  recordVoiceSteal(engine: string): void {
    this.voiceSteals += 1;
    const now = Date.now();
    if (now - this.voiceStealWindowStart > 1000) {
      this.voiceStealWindowStart = now;
      this.voiceStealsInWindow = 0;
    }
    this.voiceStealsInWindow += 1;
    if (this.voiceStealsInWindow >= PLAYBACK_THRESHOLDS.voiceStealWarnPerSec) {
      this.maybeWarn(`High voice steal rate on ${engine} (${this.voiceStealsInWindow}/s)`);
    }
  }

  recordBackpressure(source: string): void {
    this.backpressureEvents += 1;
    this.maybeWarn(`Playback back-pressure: ${source}`);
  }

  recordStepBurst(step: number): void {
    this.stepBursts += 1;
    if (import.meta.env.DEV) {
      console.debug(`[playback] duplicate step callback suppressed at step ${step}`);
    }
  }

  getSnapshot(): PlaybackHealthSnapshot {
    const sorted = [...this.schedulerLagSamples].sort((a, b) => a - b);
    const p95Idx = sorted.length > 0
      ? Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))
      : -1;
    return {
      schedulerLagP95Ms: p95Idx >= 0 ? sorted[p95Idx]! : null,
      schedulerLagMaxMs: sorted.length > 0 ? sorted[sorted.length - 1]! : 0,
      voiceSteals: this.voiceSteals,
      backpressureEvents: this.backpressureEvents,
      stepBursts: this.stepBursts,
      lastWarningTs: this.lastWarningTs,
    };
  }

  reset(): void {
    this.schedulerLagSamples = [];
    this.voiceSteals = 0;
    this.voiceStealsInWindow = 0;
    this.backpressureEvents = 0;
    this.stepBursts = 0;
    this.lastWarningTs = null;
  }

  private maybeWarn(message: string): void {
    const now = Date.now();
    if (this.lastWarningTs !== null && now - this.lastWarningTs < 3000) return;
    this.lastWarningTs = now;
    console.warn(`[playback-health] ${message}`);
    try {
      engineDegradationStore.report({
        id: 'playback-scheduler-lag',
        subsystem: 'playback',
        category: 'audio',
        message,
        reason: message,
        status: 'active',
        activeBackend: 'audio-context',
        requestedBackend: 'sample-accurate',
        retryable: false,
      });
    } catch {
      // degradation store optional in tests
    }
  }
}

export const playbackHealthMonitor = new PlaybackHealthMonitor();
