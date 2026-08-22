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
import type { ProphecyManager } from '../../engines/ProphecyManager';
import type { PcfEffect } from '../../engines/PcfEffect';
import type { WamHost } from '../wam/WamHost';
import {
  playbackHealthMonitor,
  PLAYBACK_THRESHOLDS,
} from '../playback/PlaybackHealthMonitor';
import {
  isTrakParamAutomationEvent,
  isTrakPatternSelectEvent,
  normaliseTrakParamValue,
  resolveTrakParamMapping,
} from '../../importers/rbs/trakControllers';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resolve delta-tick events into absolute-tick events. */
export function resolveTrakDeltas(
  events: Array<{ deltaTick: number; trackIndex: number; ctrlId: number; value: number; eventKind?: ResolvedTrakEvent['eventKind'] }>
): ResolvedTrakEvent[] {
  let tick = 0;
  const result: ResolvedTrakEvent[] = new Array(events.length);
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    tick += ev.deltaTick;
    result[i] = {
      tick,
      trackIndex: ev.trackIndex,
      ctrlId: ev.ctrlId,
      value: ev.value,
      eventKind: ev.eventKind,
    };
  }
  return result;
}

/**
 * Convert a raw TRAK value for a per-track controller into a normalised float.
 * Uses track-local param mapping — not the legacy automation lane enum.
 */
export function normaliseTrakValue(
  trackIndex: number,
  ctrlId: number,
  rawValue: number,
): number {
  return normaliseTrakParamValue(trackIndex, ctrlId, rawValue);
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

const PROPHECY_AUTOMATION_PARAMS = new Set(['vowel', 'portamento', 'formantShift']);

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
 * @example
 * pcfMidiNormToHz(0)   // → 20 Hz   (lowest cutoff)
 * pcfMidiNormToHz(0.5) // → ≈ 632 Hz (mid cutoff)
 * pcfMidiNormToHz(1)   // → 20 000 Hz (highest cutoff)
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
  private prophecyManager: ProphecyManager | null = null;
  private pcfEffect: PcfEffect | null = null;
  private wamHost: WamHost | null = null;

  private readonly lookaheadSeconds: number;
  private readonly rampDuration: number;
  private readonly ppq: number;

  /** setTimeout handles for PCF params (no native AudioParam scheduling). */
  private pendingTimeouts: ReturnType<typeof setTimeout>[] = [];
  /** Coalesce duplicate lane/TRAK events in the same 1 ms audio-time bucket. */
  private recentScheduleBuckets = new Map<string, number>();

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

  /** Route `target: 'wam'` lanes to a mounted WAM2 slot (`parameter` = `slotId/paramId`). */
  setWamHost(host: WamHost | null): void {
    this.wamHost = host;
  }

  /** Update ProphecyManager for audio-clock vowel/portamento automation. */
  setProphecyManager(manager: ProphecyManager | null): void {
    this.prophecyManager = manager;
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

      // Arrangement events (pattern select) must not hit knob setters.
      if (isTrakPatternSelectEvent(ev.trackIndex, ev.ctrlId, ev.eventKind)) continue;
      if (!isTrakParamAutomationEvent(ev.trackIndex, ev.ctrlId, ev.eventKind)) continue;

      const mapping = resolveTrakParamMapping(ev.trackIndex, ev.ctrlId);
      if (!mapping) continue;

      const audioTime = baseAudioTime + (ev.tick - fromTick) * tickSeconds;
      const normValue = normaliseTrakValue(ev.trackIndex, ev.ctrlId, ev.value);

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
    this.recentScheduleBuckets.clear();
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
  private _effectiveAudioTime(audioTime: number, target?: string, parameter?: string): number {
    const nowAudio = this.ctx.currentTime;
    const lagMs = Math.max(0, (nowAudio - audioTime) * 1000);
    if (lagMs > 0) {
      playbackHealthMonitor.recordSchedulerLag(lagMs, target, parameter);
    }
    if (lagMs >= PLAYBACK_THRESHOLDS.schedulerLagDropMs) {
      return nowAudio;
    }
    return audioTime;
  }

  private _shouldSkipDuplicate(target: AutomationTarget, parameter: string, audioTime: number): boolean {
    const bucket = Math.floor(audioTime * 1000);
    const key = `${target}:${parameter}`;
    const prev = this.recentScheduleBuckets.get(key);
    if (prev === bucket) return true;
    this.recentScheduleBuckets.set(key, bucket);
    return false;
  }

  private _isBackpressured(): boolean {
    if (this.pendingTimeouts.length >= PLAYBACK_THRESHOLDS.maxPendingAutomation) {
      playbackHealthMonitor.recordBackpressure('automation-pending-cap');
      return true;
    }
    return false;
  }

  private _scheduleParam(
    target: AutomationTarget,
    parameter: string,
    value: number,
    audioTime: number,
    rampDuration: number
  ): void {
    if (this._shouldSkipDuplicate(target, parameter, audioTime)) return;

    const mgr = this.open303Manager;

    if (
      (target === 'synthA' || target === 'synthB') &&
      PROPHECY_AUTOMATION_PARAMS.has(parameter) &&
      this.prophecyManager
    ) {
      const part = target === 'synthA' ? 'partA' : 'partB';
      const effectiveTime = this._effectiveAudioTime(audioTime, target, parameter);
      this.prophecyManager.scheduleParamAtTime(
        part,
        parameter as 'vowel' | 'portamento' | 'formantShift',
        value,
        effectiveTime,
      );
      return;
    }

    switch (target) {
      case 'synthA': {
        if (!mgr || !mgr.isLead303Ready()) return;
        this._apply303Param(mgr, 'lead303', parameter, value, audioTime, rampDuration);
        break;
      }
      case 'synthB': {
        if (!mgr || !mgr.isBass1Ready()) return;
        this._apply303Param(mgr, 'bass1', parameter, value, audioTime, rampDuration);
        break;
      }
      case 'bass2': {
        if (!mgr || !mgr.isBass2Ready()) return;
        this._apply303Param(mgr, 'bass2', parameter, value, audioTime, rampDuration);
        break;
      }
      case 'master': {
        if (!this.pcfEffect) return;
        if (this._isBackpressured()) return;
        const pcf = this.pcfEffect;
        const effectiveTime = this._effectiveAudioTime(audioTime, target, parameter);
        const nowAudio = this.ctx.currentTime;
        const delayMs = Math.max(0, (effectiveTime - nowAudio) * 1000);
        if (delayMs < 1) {
          this._applyPcfParam(pcf, parameter, value);
        } else {
          const id = setTimeout(() => {
            this._applyPcfParam(pcf, parameter, value);
          }, delayMs);
          this.pendingTimeouts.push(id);
        }
        break;
      }
      case 'wam': {
        if (!this.wamHost) return;
        const slash = parameter.indexOf('/');
        if (slash <= 0) return;
        const slotId = parameter.slice(0, slash);
        const paramId = parameter.slice(slash + 1);
        const effectiveTime = this._effectiveAudioTime(audioTime, target, parameter);
        this.wamHost.setParam(slotId, paramId, clamp01(value), effectiveTime);
        break;
      }
      default:
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
    audioTime: number,
    _rampDuration: number
  ): void {
    const v = clamp01(value);
    const effectiveTime = this._effectiveAudioTime(audioTime, voice, parameter);
    switch (parameter) {
      case 'filterCutoff':
      case 'cutoff':
      case 'tb303Acutoff':
      case 'tb303Bcutoff':
        mgr.scheduleParamAtTime(voice, 'setCutoff', v, effectiveTime);
        break;
      case 'filterResonance':
      case 'resonance':
      case 'tb303Aresonance':
      case 'tb303Bresonance':
        mgr.scheduleParamAtTime(voice, 'setResonance', v, effectiveTime);
        break;
      case 'decay':
      case 'tb303Adecay':
      case 'tb303Bdecay':
        mgr.scheduleParamAtTime(voice, 'setDecay', v, effectiveTime);
        break;
      case 'envMod':
        mgr.scheduleParamAtTime(voice, 'setEnvMod', v, effectiveTime);
        break;
      case 'accent':
        mgr.scheduleParamAtTime(voice, 'setAccent', v, effectiveTime);
        break;
      case 'slide':
        mgr.scheduleSlideAtTime(voice, v > 0.5, effectiveTime);
        break;
      case 'volume':
        mgr.scheduleParamAtTime(voice, 'setVolume', v, effectiveTime);
        break;
      case 'drive':
        mgr.scheduleParamAtTime(voice, 'setDrive', v, effectiveTime);
        break;
      default:
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

// trakCtrlToTargetParam removed — per-track mapping lives in trakControllers.ts
