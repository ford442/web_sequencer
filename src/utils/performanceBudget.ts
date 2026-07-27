/**
 * Auto-degrade policy when the audio-thread CPU budget exceeds threshold.
 * See docs/PERFORMANCE_BUDGET.md for the documented degrade order.
 */

import { engineTelemetry } from './engineTelemetry';
import { engineDegradationStore } from '../stores/engineDegradationStore';

/**
 * Soft target for offline 303 render latency (ms). Used by HUD / callers —
 * not part of the real-time degrade ladder (see OFFLINE_303_OVERSAMPLE.md).
 */
export const OFFLINE_303_RENDER_BUDGET_MS = 400;

/** Master budget % above which degradations begin applying (in order). */
export const BUDGET_OVERLOAD_THRESHOLD = 80;
/** Master budget % below which recoveries are considered (hysteresis). */
export const BUDGET_RECOVERY_THRESHOLD = 60;

export type DegradeStep =
  | 'spectral-pan'
  | 'granular-quality'
  | 'vocoder-stft'
  | 'webgpu-knobs';

/** Documented degrade order — lowest impact / highest savings first. */
export const DEGRADE_ORDER: readonly DegradeStep[] = [
  'spectral-pan',
  'granular-quality',
  'vocoder-stft',
  'webgpu-knobs',
] as const;

export interface PerformanceBudgetState {
  masterBudgetPercent: number;
  activeDegradations: DegradeStep[];
  spectralPanMultiplier: number;
  granularQuality: 'high' | 'fast';
  vocoderStftEnabled: boolean;
  webgpuKnobsEnabled: boolean;
}

type RubberbandQualityHandler = (profile: 'vocal' | 'fast') => void;

class PerformanceBudget {
  private active = new Set<DegradeStep>();
  private rubberbandHandlers = new Set<RubberbandQualityHandler>();
  private lastEvaluateAt = 0;
  private readonly EVAL_THROTTLE_MS = 200;

  getState(): PerformanceBudgetState {
    const snap = engineTelemetry.getRuntimeSnapshot();
    return {
      masterBudgetPercent: snap.masterBudgetPercent,
      activeDegradations: [...this.active],
      spectralPanMultiplier: this.active.has('spectral-pan') ? 0 : 1,
      granularQuality: this.active.has('granular-quality') ? 'fast' : 'high',
      vocoderStftEnabled: !this.active.has('vocoder-stft'),
      webgpuKnobsEnabled: !this.active.has('webgpu-knobs'),
    };
  }

  /** Multiplier applied to spectralPanDepth (0 = disabled under load). */
  getSpectralPanMultiplier(): number {
    return this.active.has('spectral-pan') ? 0 : 1;
  }

  registerRubberbandHandler(handler: RubberbandQualityHandler): () => void {
    this.rubberbandHandlers.add(handler);
    return () => this.rubberbandHandlers.delete(handler);
  }

  evaluate(): void {
    const now = Date.now();
    if (now - this.lastEvaluateAt < this.EVAL_THROTTLE_MS) return;
    this.lastEvaluateAt = now;

    const budget = engineTelemetry.getRuntimeSnapshot().masterBudgetPercent;

    if (budget >= BUDGET_OVERLOAD_THRESHOLD) {
      for (const step of DEGRADE_ORDER) {
        if (!this.active.has(step)) {
          this.applyDegradation(step, budget);
          break;
        }
      }
    } else if (budget <= BUDGET_RECOVERY_THRESHOLD && this.active.size > 0) {
      const last = DEGRADE_ORDER[DEGRADE_ORDER.length - 1];
      for (let i = DEGRADE_ORDER.length - 1; i >= 0; i--) {
        const step = DEGRADE_ORDER[i];
        if (this.active.has(step)) {
          this.recoverDegradation(step, budget);
          break;
        }
      }
      void last;
    }
  }

  private applyDegradation(step: DegradeStep, budget: number): void {
    this.active.add(step);
    const reason = `master budget ${budget.toFixed(1)}% ≥ ${BUDGET_OVERLOAD_THRESHOLD}%`;

    switch (step) {
      case 'spectral-pan':
        engineDegradationStore.report({
          id: 'perf-spectral-pan',
          subsystem: 'spectral-pan',
          category: 'audio',
          message: 'Spectral pan disabled (CPU budget)',
          reason,
          status: 'active',
          activeBackend: 'disabled',
          requestedBackend: 'enabled',
          retryable: true,
        });
        break;
      case 'granular-quality':
        this.rubberbandHandlers.forEach((h) => {
          try {
            h('fast');
          } catch {
            /* ignore */
          }
        });
        engineDegradationStore.report({
          id: 'perf-granular',
          subsystem: 'rubberband',
          category: 'worklet',
          message: 'Granular quality reduced (CPU budget)',
          reason,
          status: 'active',
          activeBackend: 'fast',
          requestedBackend: 'finer',
          retryable: true,
        });
        break;
      case 'vocoder-stft':
        engineDegradationStore.report({
          id: 'perf-vocoder',
          subsystem: 'vocoder',
          category: 'worklet',
          message: 'Vocoder STFT reduced (CPU budget)',
          reason,
          status: 'active',
          activeBackend: 'bypass',
          requestedBackend: 'stft',
          retryable: true,
        });
        break;
      case 'webgpu-knobs':
        engineDegradationStore.report({
          id: 'perf-gpu-knobs',
          subsystem: 'gpu-knobs',
          category: 'gpu',
          message: 'WebGPU knobs disabled (CPU budget)',
          reason,
          status: 'active',
          activeBackend: 'css',
          requestedBackend: 'webgpu',
          retryable: true,
        });
        if (typeof window !== 'undefined') {
          window.dispatchEvent(
            new CustomEvent('hyphon-perf-degrade', { detail: { step, budget } }),
          );
        }
        break;
    }

    engineTelemetry.recordDegradation(step, true, reason);
  }

  private recoverDegradation(step: DegradeStep, budget: number): void {
    this.active.delete(step);
    const reason = `master budget ${budget.toFixed(1)}% ≤ ${BUDGET_RECOVERY_THRESHOLD}%`;

    switch (step) {
      case 'granular-quality':
        this.rubberbandHandlers.forEach((h) => {
          try {
            h('vocal');
          } catch {
            /* ignore */
          }
        });
        break;
      case 'webgpu-knobs':
        if (typeof window !== 'undefined') {
          window.dispatchEvent(
            new CustomEvent('hyphon-perf-recover', { detail: { step, budget } }),
          );
        }
        break;
      default:
        break;
    }

    engineDegradationStore.resolve(`perf-${step === 'spectral-pan' ? 'spectral-pan' : step === 'granular-quality' ? 'granular' : step === 'vocoder-stft' ? 'vocoder' : 'gpu-knobs'}`);
    engineTelemetry.recordDegradation(step, false, reason);
  }

  /** Test hook: reset all active degradations. */
  resetForTests(): void {
    this.active.clear();
    this.lastEvaluateAt = 0;
  }
}

export const performanceBudget = new PerformanceBudget();
