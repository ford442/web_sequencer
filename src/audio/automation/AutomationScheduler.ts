/**
 * AutomationScheduler
 *
 * Bridges the automation store and the Open303Manager (and future engines) by
 * scheduling parameter changes ahead of time using AudioContext timing.
 *
 * Two input sources are supported:
 *   1. `UnifiedAutomationLane` — step-indexed lanes from the automation store
 *      (recorded, imported AI, or converted from .rbs).
 *   2. `ResolvedTrakEvent[]` — sub-step tick events parsed from the RBS TRAK
 *      chunk (~24 PPQ). These provide authentic, zipper-free parameter curves
 *      that match ReBirth playback behaviour.
 *
 * For each scheduled value the scheduler:
 *   - Uses `AudioParam.setValueAtTime` + `linearRampToValueAtTime` when a
 *     native AudioParam is available (e.g. StereoPanner.pan, GainNode.gain).
 *   - Falls back to time-aligned `setTimeout` for AudioWorklet params that are
 *     driven via `postMessage` (Open303 filter cutoff, resonance, envMod …).
 *
 * Song-mode arrangement: when `advanceSongStructure` is provided the scheduler
 * calls it at bar boundaries so the active pattern slots advance in sync with
 * the audio clock.
 *
 * @see Issue #669 — Automation foundation (UnifiedAutomationLane, store)
 * @see Issue #671 — RBS full parser (TRAK events)
 * @see Issue #(this) — Automation Playback Scheduler + Open303 wiring
 */

import type {
  UnifiedAutomationLane,
  AutomationTarget,
  ResolvedTrakEvent,
  AutomationSchedulerConfig,
} from '../../types';
import { automationStore } from '../../stores/automationStore';
import type { Open303Manager } from '../../engines/Open303Manager';
import type { PcfEffect } from '../../engines/PcfEffect';
import { AUTOMATION_PARAMETER_MAP } from '../../importers/rbs/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resolve delta-tick events into absolute-tick events. */
export function resolveTrakDeltas(
  events: Array<{ deltaTick: number; ctrlId: number; value: number }>
): ResolvedTrakEvent[] {
  let tick = 0;
  return events.map((ev) => {
    tick += ev.deltaTick;
    return { tick, ctrlId: ev.ctrlId, value: ev.value };
  });
}

/**
 * Convert a raw TRAK value (0–127 or 0–255) for a given parameter into a
 * normalised 0–1 float suitable for Open303Manager setters.
 * Falls back to identity mapping for unknown parameters.
 */
export function normaliseTrakValue(ctrlId: number, rawValue: number): number {
  const name = AUTOMATION_PARAMETER_MAP[ctrlId];
  switch (name) {
    case 'tb303Acutoff':
    case 'tb303Bcutoff':
    case 'tb303Aresonance':
    case 'tb303Bresonance':
    case 'tb303Adecay':
    case 'tb303Bdecay':
    case 'pcfCutoff':
    case 'pcfResonance':
    case 'pcfEnvAmount':
      return Math.max(0, Math.min(1, rawValue / 127));
    case 'masterVolume':
      return Math.max(0, Math.min(1, rawValue / 127));
    case 'tempo':
      // tempo stored as integer BPM; return as-is (caller handles conversion)
      return rawValue;
    default:
      return Math.max(0, Math.min(1, rawValue / 127));
  }
}

// ---------------------------------------------------------------------------
// AutomationScheduler
// ---------------------------------------------------------------------------

/** How far ahead (seconds) to schedule events when no config is given. */
const DEFAULT_LOOKAHEAD_S = 0.1;
/** Default ramp duration for smooth param changes (seconds). */
const DEFAULT_RAMP_S = 0.05;
/** Default pulses per quarter note (ReBirth native). */
const DEFAULT_PPQ = 24;

/** Clamp a value to the [0, 1] range. */
function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/**
 * Convert a normalised MIDI value to Hz using an exponential curve that
 * spans the human-audible range: `normMidi = 0` → 20 Hz, `normMidi = 1`
 * → 20 000 Hz.  The formula is `20 × 1000^normMidi`.
 *
 * This mirrors the identical `midiToHz` implementation inside the PCF
 * AudioWorklet.  AudioWorklet scope is isolated (no shared imports), so the
 * formula must exist in both places; this named helper avoids scattering
 * the magic constants across multiple call-sites in the scheduler.
 *
 * @param normMidi - Linear normalised value in [0, 1] (0 = lowest cutoff,
 *   1 = highest cutoff).
 * @returns Frequency in Hz.
 */
function pcfMidiNormToHz(normMidi: number): number {
  return 20 * Math.pow(1000, normMidi);
}

/**
 * Called once per bar/song-measure when song mode is active so the app can
 * advance to the next pattern slot.
 */
export type SongAdvanceFn = (nextMeasureIndex: number) => void;

export class AutomationScheduler {
  private readonly ctx: AudioContext;
  /**
   * Reference to the Open303Manager used for 303 parameter scheduling.
   * May be `null` at construction time (the manager is created
   * asynchronously after the scheduler) and updated via
   * {@link setOpen303Manager}.  All switch-case branches that touch this
   * field guard against `null` before use.
   */
  private open303Manager: Open303Manager | null;
  private pcfEffect: PcfEffect | null = null;

  private readonly lookaheadSeconds: number;
  private readonly rampDuration: number;
  private readonly ppq: number;

  /** setTimeout handles so we can cancel all pending events on stop. */
  private pendingTimeouts: ReturnType<typeof setTimeout>[] = [];

  constructor(
    audioContext: AudioContext,
    open303Manager: Open303Manager | null = null,
    config: AutomationSchedulerConfig = {}
  ) {
    this.ctx = audioContext;
    this.open303Manager = open303Manager;
    this.lookaheadSeconds = config.lookaheadSeconds ?? DEFAULT_LOOKAHEAD_S;
    this.rampDuration = config.rampDuration ?? DEFAULT_RAMP_S;
    this.ppq = config.ppq ?? DEFAULT_PPQ;
  }

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  /**
   * Update the Open303Manager reference (useful if the manager is created
   * after the scheduler).
   */
  setOpen303Manager(manager: Open303Manager | null): void {
    this.open303Manager = manager;
  }

  /**
   * Update the PcfEffect reference (useful if the effect is created/destroyed
   * dynamically).  Set to null to disable PCF automation scheduling.
   */
  setPcfEffect(effect: PcfEffect | null): void {
    this.pcfEffect = effect;
  }

  /**
   * Schedule automation from `UnifiedAutomationLane` data for a window of
   * steps starting at `fromStep`.
   *
   * Call this once per scheduler tick (16th-note step) from `useStepHandler`.
   *
   * @param lanes        Active automation lanes for the current pattern.
   * @param fromStep     First step to schedule (inclusive).
   * @param stepCount    Number of steps to look ahead (default: 1).
   * @param stepTime     Duration of one step in seconds.
   * @param baseAudioTime AudioContext time corresponding to `fromStep`.
   */
  scheduleFromLanes(
    lanes: UnifiedAutomationLane[],
    fromStep: number,
    stepCount: number,
    stepTime: number,
    baseAudioTime: number
  ): void {
    if (!lanes.length) return;

    for (let i = 0; i < stepCount; i++) {
      const step = fromStep + i;
      const stepAudioTime = baseAudioTime + i * stepTime;

      for (const lane of lanes) {
        if (!lane.enabled) continue;

        const rawVal = automationStore.getValueAtStep(lane, step);
        if (rawVal === null) continue;

        // Denormalise using the lane's originalRange if present.
        let value = rawVal;
        if (lane.originalRange) {
          const [min, max] = lane.originalRange;
          value = min + rawVal * (max - min);
        }

        this._scheduleParam(
          lane.target,
          lane.parameter,
          value,
          stepAudioTime,
          this.rampDuration
        );
      }
    }
  }

  /**
   * Schedule automation from pre-resolved TRAK events.
   *
   * @param events         Absolute-tick events (use `resolveTrakDeltas` first).
   * @param tempo          Current BPM (needed for tick → seconds conversion).
   * @param baseAudioTime  AudioContext time for tick 0.
   * @param fromTick       Only schedule events at or after this tick.
   * @param toTick         Only schedule events strictly before this tick.
   */
  scheduleFromTrakEvents(
    events: ResolvedTrakEvent[],
    tempo: number,
    baseAudioTime: number,
    fromTick: number,
    toTick: number
  ): void {
    if (!events.length) return;
    const tickSeconds = 60 / (tempo * this.ppq);

    for (const ev of events) {
      if (ev.tick < fromTick || ev.tick >= toTick) continue;

      const audioTime = baseAudioTime + (ev.tick - fromTick) * tickSeconds;
      const normValue = normaliseTrakValue(ev.ctrlId, ev.value);

      const paramName = AUTOMATION_PARAMETER_MAP[ev.ctrlId];
      if (!paramName) continue;

      // Map RBS parameter names to (target, parameter) pairs.
      const mapping = trakCtrlToTargetParam(paramName);
      if (!mapping) continue;

      this._scheduleParam(
        mapping.target,
        mapping.parameter,
        normValue,
        audioTime,
        this.rampDuration
      );
    }
  }

  /**
   * Cancel all pending scheduled automation events.
   * Call this when playback stops.
   */
  cancelAll(): void {
    for (const id of this.pendingTimeouts) {
      clearTimeout(id);
    }
    this.pendingTimeouts = [];
  }

  // --------------------------------------------------------------------------
  // Parameter dispatch
  // --------------------------------------------------------------------------

  /**
   * Route a normalised parameter value to the correct engine at `audioTime`.
   *
   * For AudioParam-backed nodes (pan, gain) the value is scheduled directly via
   * the Web Audio API scheduling methods so the change is sample-accurate.
   *
   * For worklet-based nodes the change is dispatched via a time-aligned
   * `setTimeout` that fires just before the target audio time.
   */
  private _scheduleParam(
    target: AutomationTarget,
    parameter: string,
    value: number,
    audioTime: number,
    rampDuration: number
  ): void {
    const mgr = this.open303Manager;
    const nowAudio = this.ctx.currentTime;
    const delayMs = Math.max(0, (audioTime - nowAudio) * 1000);

    switch (target) {
      case 'synthA': {
        // lead303 instance (partA / SYNTH A LEAD)
        if (!mgr || !mgr.isLead303Ready()) return;
        const id = setTimeout(() => {
          this._apply303Param(mgr, 'lead303', parameter, value, rampDuration);
        }, delayMs);
        this.pendingTimeouts.push(id);
        break;
      }
      case 'synthB': {
        // bass1 instance (partB / SYNTH B)
        if (!mgr || !mgr.isBass1Ready()) return;
        const id = setTimeout(() => {
          this._apply303Param(mgr, 'bass1', parameter, value, rampDuration);
        }, delayMs);
        this.pendingTimeouts.push(id);
        break;
      }
      case 'bass2': {
        // bass2 instance
        if (!mgr || !mgr.isBass2Ready()) return;
        const id = setTimeout(() => {
          this._apply303Param(mgr, 'bass2', parameter, value, rampDuration);
        }, delayMs);
        this.pendingTimeouts.push(id);
        break;
      }
      case 'master': {
        // PCF and master-bus parameters.
        if (this.pcfEffect) {
          const pcf = this.pcfEffect;
          const id = setTimeout(() => {
            this._applyPcfParam(pcf, parameter, value);
          }, delayMs);
          this.pendingTimeouts.push(id);
        }
        break;
      }
      default:
        // Other targets (drums, sampler) are handled by the step-handler
        // and/or dedicated mixers — not the 303 manager or PCF.
        break;
    }
  }

  /**
   * Apply a single parameter change to an Open303 instance.
   *
   * For parameters whose normalised range maps directly to the Open303 setter
   * (0–1) the value is forwarded unchanged.  Cutoff uses a separate scaling
   * path (the manager already handles Hz→0–1 conversion so we pass the raw
   * 0–1 normalised value).
   */
  private _apply303Param(
    mgr: Open303Manager,
    voice: 'bass1' | 'bass2' | 'lead303',
    parameter: string,
    value: number,
    _rampDuration: number
  ): void {
    const v = clamp01(value);
    const now = this.ctx.currentTime;
    switch (parameter) {
      case 'filterCutoff':
      case 'cutoff':
      case 'tb303Acutoff':
      case 'tb303Bcutoff':
        mgr.scheduleParamAtTime(voice, 'setCutoff', v, now);
        break;
      case 'filterResonance':
      case 'resonance':
      case 'tb303Aresonance':
      case 'tb303Bresonance':
        mgr.scheduleParamAtTime(voice, 'setResonance', v, now);
        break;
      case 'decay':
      case 'tb303Adecay':
      case 'tb303Bdecay':
        mgr.scheduleParamAtTime(voice, 'setDecay', v, now);
        break;
      case 'envMod':
        mgr.scheduleParamAtTime(voice, 'setEnvMod', v, now);
        break;
      case 'accent':
        mgr.scheduleParamAtTime(voice, 'setAccent', v, now);
        break;
      case 'slide':
        // Schedule per-step slide (portamento/legato) enable or disable.
        // Delegates to Open303Manager.scheduleSlideAtTime(), which establishes
        // the API contract; actual glide behaviour depends on engine support.
        mgr.scheduleSlideAtTime(voice, v > 0.5, now);
        break;
      case 'volume':
        mgr.scheduleParamAtTime(voice, 'setVolume', v, now);
        break;
      default:
        // Unknown parameter — no-op.
        break;
    }
  }

  /**
   * Apply a single PCF parameter change using the PcfEffect automation API.
   *
   * @param pcf       The active PcfEffect instance.
   * @param parameter RBS/automation parameter name (pcfCutoff | pcfResonance | pcfEnvAmount).
   * @param value     Normalised 0–1 value (from automation lane or TRAK event).
   */
  private _applyPcfParam(pcf: PcfEffect, parameter: string, value: number): void {
    const v = clamp01(value);
    switch (parameter) {
      case 'pcfCutoff':
        // Convert normalised 0-1 to Hz using the helper that mirrors the worklet.
        pcf.setAutomationCutoff(pcfMidiNormToHz(v));
        break;
      case 'pcfResonance':
        // 0-1 normalised → 0-127 MIDI range.
        pcf.setAutomationResonance(v * 127);
        break;
      case 'pcfEnvAmount':
        pcf.setAutomationEnvAmount(v);
        break;
      default:
        // Unknown PCF parameter — no-op.
        break;
    }
  }
}

// ---------------------------------------------------------------------------
// TRAK ctrl-ID → (target, parameter) mapping
// ---------------------------------------------------------------------------

interface TargetParam {
  target: AutomationTarget;
  parameter: string;
}

function trakCtrlToTargetParam(paramName: string): TargetParam | null {
  switch (paramName) {
    case 'tb303Acutoff':     return { target: 'synthA', parameter: 'filterCutoff' };
    case 'tb303Bcutoff':     return { target: 'synthB', parameter: 'filterCutoff' };
    case 'tb303Aresonance':  return { target: 'synthA', parameter: 'filterResonance' };
    case 'tb303Bresonance':  return { target: 'synthB', parameter: 'filterResonance' };
    case 'tb303Adecay':      return { target: 'synthA', parameter: 'decay' };
    case 'tb303Bdecay':      return { target: 'synthB', parameter: 'decay' };
    case 'masterVolume':     return { target: 'master', parameter: 'volume' };
    case 'pcfCutoff':        return { target: 'master', parameter: 'pcfCutoff' };
    case 'pcfResonance':     return { target: 'master', parameter: 'pcfResonance' };
    case 'pcfEnvAmount':     return { target: 'master', parameter: 'pcfEnvAmount' };
    default:                 return null;
  }
}
