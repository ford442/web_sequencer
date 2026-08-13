/**
 * Automation Store
 *
 * Centralized state management for automation lanes, record-arm flags,
 * recording buffers, and playback position. Supports import from .rbs,
 * live recording, and AI-generated automation.
 *
 * Uses a subscription pattern (like loadingProgressStore) for decoupled updates.
 *
 * @see Issue #652 — Core data model, store, and types for automation lanes
 */

import React from 'react';
import type {
  AutomationState,
  UnifiedAutomationLane,
  AutomationLanePoint,
  AutomationTarget,
  AutomationSource,
  AutomationInterpolation,
  AutomationScope,
  AutomationRecordArm,
  AutomationRecordingBuffer,
} from '../types';
import type { HyphonAutomationLane } from '../importers/rbs/types';
import { interpolateLaneAtStep } from '../utils/knobAutomationCurve';

const EMPTY_LANES: UnifiedAutomationLane[] = [];

// ============================================================================
// HELPERS
// ============================================================================

let nextLaneId = 1;

/** Generate a unique lane ID */
export function generateLaneId(): string {
  return `auto_lane_${nextLaneId++}_${Date.now().toString(36)}`;
}

/** Reset ID counter (for testing) */
export function resetLaneIdCounter(): void {
  nextLaneId = 1;
}

// ============================================================================
// CONVERSION UTILITIES
// ============================================================================

/**
 * Convert a HyphonAutomationLane (from .rbs import) to a UnifiedAutomationLane.
 */
export function convertHyphonLane(
  lane: HyphonAutomationLane,
  patternIndex?: number
): UnifiedAutomationLane {
  const points: AutomationLanePoint[] = lane.points.map(([step, value]) => ({
    step,
    value,
  }));

  return {
    id: generateLaneId(),
    target: lane.target,
    parameter: lane.parameter,
    name: lane.name,
    points,
    interpolation: lane.interpolation,
    source: 'rbs',
    scope: patternIndex !== undefined ? 'pattern' : 'song',
    patternIndex,
    enabled: true,
    originalRange: lane.originalRange,
  };
}

/**
 * Convert multiple HyphonAutomationLanes from an RBS import.
 */
export function convertHyphonLanes(
  lanes: HyphonAutomationLane[],
  patternIndex?: number
): UnifiedAutomationLane[] {
  return lanes.map((lane) => convertHyphonLane(lane, patternIndex));
}

// ============================================================================
// STORE
// ============================================================================

type AutomationListener = (state: AutomationState) => void;

function createInitialState(): AutomationState {
  return {
    lanes: [],
    recordArms: [],
    recordingBuffers: [],
    playbackStep: 0,
    playbackEnabled: true,
    liveAutomatedValues: {},
    showHardwareAutomation: false,
  };
}

class AutomationStore {
  private state: AutomationState;
  private listeners: Set<AutomationListener> = new Set();

  // Cache to map "target:parameter" to pre-filtered lanes for O(1) lookups during playback
  private lanesCache: { ref: UnifiedAutomationLane[]; map: Map<string, UnifiedAutomationLane[]> } = {
    ref: [],
    map: new Map(),
  };

  constructor() {
    this.state = createInitialState();
  }

  // --------------------------------------------------------------------------
  // Subscriptions
  // --------------------------------------------------------------------------

  subscribe(listener: AutomationListener): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    const state = this.getState();
    this.listeners.forEach((listener) => listener(state));
  }

  getState(): AutomationState {
    return { ...this.state };
  }

  // --------------------------------------------------------------------------
  // Lane Management
  // --------------------------------------------------------------------------

  /** Add a single lane */
  addLane(lane: UnifiedAutomationLane): void {
    this.state = {
      ...this.state,
      lanes: [...this.state.lanes, lane],
    };
    this.notify();
  }

  /** Add multiple lanes (e.g. from RBS import) */
  addLanes(lanes: UnifiedAutomationLane[]): void {
    if (lanes.length === 0) return;
    this.state = {
      ...this.state,
      lanes: [...this.state.lanes, ...lanes],
    };
    this.notify();
  }

  /** Remove a lane by ID */
  removeLane(laneId: string): void {
    this.state = {
      ...this.state,
      lanes: this.state.lanes.filter((l) => l.id !== laneId),
    };
    this.notify();
  }

  /** Update a lane's points */
  updateLanePoints(laneId: string, points: AutomationLanePoint[]): void {
    this.state = {
      ...this.state,
      lanes: this.state.lanes.map((l) =>
        l.id === laneId ? { ...l, points: [...points].sort((a, b) => a.step - b.step) } : l
      ),
    };
    this.notify();
  }

  /** Update a lane's interpolation mode */
  updateLaneInterpolation(laneId: string, interpolation: AutomationInterpolation): void {
    this.state = {
      ...this.state,
      lanes: this.state.lanes.map((l) =>
        l.id === laneId ? { ...l, interpolation } : l
      ),
    };
    this.notify();
  }

  /** Update a lane's name */
  updateLaneName(laneId: string, name: string): void {
    this.state = {
      ...this.state,
      lanes: this.state.lanes.map((l) =>
        l.id === laneId ? { ...l, name } : l
      ),
    };
    this.notify();
  }

  /** Toggle lane enabled state */
  toggleLaneEnabled(laneId: string): void {
    this.state = {
      ...this.state,
      lanes: this.state.lanes.map((l) =>
        l.id === laneId ? { ...l, enabled: !l.enabled } : l
      ),
    };
    this.notify();
  }

  setLaneEnabled(laneId: string, enabled: boolean): void {
    this.state = {
      ...this.state,
      lanes: this.state.lanes.map((l) =>
        l.id === laneId ? { ...l, enabled } : l
      ),
    };
    this.notify();
  }

  /** Enable/disable all lanes for a target+parameter pair. */
  setLanesEnabledForParam(target: AutomationTarget, parameter: string, enabled: boolean): void {
    this.state = {
      ...this.state,
      lanes: this.state.lanes.map((l) =>
        l.target === target && l.parameter === parameter ? { ...l, enabled } : l
      ),
    };
    this.notify();
  }

  /** Remove all lanes targeting a parameter. */
  clearLanesForParam(target: AutomationTarget, parameter: string): void {
    this.state = {
      ...this.state,
      lanes: this.state.lanes.filter(
        (l) => !(l.target === target && l.parameter === parameter),
      ),
    };
    this.notify();
  }

  /** Primary enabled lane for a parameter in the current pattern scope. */
  getPrimaryLaneForParam(
    target: AutomationTarget,
    parameter: string,
    patternIndex = 0,
  ): UnifiedAutomationLane | null {
    const lanes = this.getLanesForParam(target, parameter).filter((l) => {
      if (!l.enabled) return false;
      return l.scope === 'song' || (l.scope === 'pattern' && l.patternIndex === patternIndex);
    });
    return lanes[0] ?? null;
  }

  /** Add or replace a point at the given step on a lane. */
  upsertLanePoint(laneId: string, step: number, value: number): void {
    const lane = this.state.lanes.find((l) => l.id === laneId);
    if (!lane) return;
    const clamped = Math.max(0, Math.min(1, value));
    const next = [...lane.points];
    const idx = next.findIndex((p) => p.step === step);
    if (idx >= 0) {
      next[idx] = { ...next[idx], value: clamped };
    } else {
      next.push({ step, value: clamped });
    }
    this.updateLanePoints(laneId, next);
  }

  setShowHardwareAutomation(show: boolean): void {
    if (this.state.showHardwareAutomation === show) return;
    this.state = { ...this.state, showHardwareAutomation: show };
    this.notify();
  }

  toggleShowHardwareAutomation(): void {
    this.setShowHardwareAutomation(!this.state.showHardwareAutomation);
  }

  /** Get lanes for a specific target and parameter */
  getLanesForParam(target: AutomationTarget, parameter: string): UnifiedAutomationLane[] {
    if (this.lanesCache.ref !== this.state.lanes) {
      const map = new Map<string, UnifiedAutomationLane[]>();
      const lanes = this.state.lanes;
      for (let i = 0; i < lanes.length; i++) {
        const lane = lanes[i];
        const key = `${lane.target}:${lane.parameter}`;
        let bucket = map.get(key);
        if (!bucket) {
          bucket = [];
          map.set(key, bucket);
        }
        bucket.push(lane);
      }
      this.lanesCache = { ref: lanes, map };
    }
    const key = `${target}:${parameter}`;
    return this.lanesCache.map.get(key) || EMPTY_LANES;
  }

  /** Get lanes targeting a specific sampler bank (0–7) */
  getLanesForSamplerBank(bankIndex: number, parameter?: string): UnifiedAutomationLane[] {
    const bankTarget = `sampler${bankIndex}` as AutomationTarget;
    return this.state.lanes.filter((l) => {
      // Match explicit per-bank target (e.g. 'sampler0')
      const matchesTarget = l.target === bankTarget ||
        (l.target === 'sampler' && l.samplerBank === bankIndex);
      if (!matchesTarget) return false;
      if (parameter) return l.parameter === parameter;
      return true;
    });
  }

  /** Get all enabled lanes for a given pattern index */
  getActiveLanesForPattern(patternIndex: number): UnifiedAutomationLane[] {
    return this.state.lanes.filter(
      (l) =>
        l.enabled &&
        (l.scope === 'song' || (l.scope === 'pattern' && l.patternIndex === patternIndex))
    );
  }

  /** Clear all lanes (e.g. when loading a new song) */
  clearAllLanes(): void {
    this.state = {
      ...this.state,
      lanes: [],
    };
    this.notify();
  }

  /** Clear lanes from a specific source */
  clearLanesBySource(source: AutomationSource): void {
    this.state = {
      ...this.state,
      lanes: this.state.lanes.filter((l) => l.source !== source),
    };
    this.notify();
  }

  // --------------------------------------------------------------------------
  // Record-Arm
  // --------------------------------------------------------------------------

  /** Arm a parameter for recording */
  armParameter(target: AutomationTarget, parameter: string): void {
    const existing = this.state.recordArms.find(
      (a) => a.target === target && a.parameter === parameter
    );
    if (existing?.armed) return; // already armed

    const newArms = this.state.recordArms.filter(
      (a) => !(a.target === target && a.parameter === parameter)
    );
    newArms.push({ target, parameter, armed: true });

    this.state = { ...this.state, recordArms: newArms };
    this.notify();
  }

  /** Disarm a parameter */
  disarmParameter(target: AutomationTarget, parameter: string): void {
    this.state = {
      ...this.state,
      recordArms: this.state.recordArms.map((a) =>
        a.target === target && a.parameter === parameter ? { ...a, armed: false } : a
      ),
    };
    this.notify();
  }

  /** Check if a parameter is armed */
  isParameterArmed(target: AutomationTarget, parameter: string): boolean {
    return this.state.recordArms.some(
      (a) => a.target === target && a.parameter === parameter && a.armed
    );
  }

  /** Disarm all parameters */
  disarmAll(): void {
    this.state = {
      ...this.state,
      recordArms: this.state.recordArms.map((a) => ({ ...a, armed: false })),
    };
    this.notify();
  }

  // --------------------------------------------------------------------------
  // Recording Buffers
  // --------------------------------------------------------------------------

  /** Start recording for an armed parameter */
  startRecording(target: AutomationTarget, parameter: string): void {
    // Remove existing buffer for this target/param
    const buffers = this.state.recordingBuffers.filter(
      (b) => !(b.target === target && b.parameter === parameter)
    );
    buffers.push({
      target,
      parameter,
      points: [],
      startTime: performance.now(),
      isRecording: true,
    });
    this.state = { ...this.state, recordingBuffers: buffers };
    this.notify();
  }

  /**
   * Record a point during active recording.
   * NOTE: Does not notify subscribers on each point for performance reasons —
   * recording can produce 60+ points/sec. Consumers needing live feedback
   * should poll getState() or use a separate RAF-based display loop.
   */
  recordPoint(target: AutomationTarget, parameter: string, point: AutomationLanePoint): void {
    this.state = {
      ...this.state,
      recordingBuffers: this.state.recordingBuffers.map((b) =>
        b.target === target && b.parameter === parameter && b.isRecording
          ? { ...b, points: [...b.points, point] }
          : b
      ),
    };
  }

  /** Stop recording and commit buffer to a new lane */
  stopRecording(
    target: AutomationTarget,
    parameter: string,
    options?: { name?: string; scope?: AutomationScope; patternIndex?: number }
  ): UnifiedAutomationLane | null {
    const buffer = this.state.recordingBuffers.find(
      (b) => b.target === target && b.parameter === parameter && b.isRecording
    );
    if (!buffer || buffer.points.length === 0) {
      // Remove buffer without creating a lane
      this.state = {
        ...this.state,
        recordingBuffers: this.state.recordingBuffers.filter(
          (b) => !(b.target === target && b.parameter === parameter)
        ),
      };
      this.notify();
      return null;
    }

    const newLane: UnifiedAutomationLane = {
      id: generateLaneId(),
      target,
      parameter,
      name: options?.name || `${target}.${parameter} (recorded)`,
      points: [...buffer.points].sort((a, b) => a.step - b.step),
      interpolation: 'linear',
      source: 'recorded',
      scope: options?.scope || 'pattern',
      patternIndex: options?.patternIndex,
      enabled: true,
    };

    this.state = {
      ...this.state,
      lanes: [...this.state.lanes, newLane],
      recordingBuffers: this.state.recordingBuffers.filter(
        (b) => !(b.target === target && b.parameter === parameter)
      ),
    };
    this.notify();
    return newLane;
  }

  /** Cancel recording without committing */
  cancelRecording(target: AutomationTarget, parameter: string): void {
    this.state = {
      ...this.state,
      recordingBuffers: this.state.recordingBuffers.filter(
        (b) => !(b.target === target && b.parameter === parameter)
      ),
    };
    this.notify();
  }

  // --------------------------------------------------------------------------
  // Playback
  // --------------------------------------------------------------------------

  /**
   * Update the current playback step position.
   * NOTE: Does not notify subscribers — called on every 16th-note tick.
   * The playback scheduler reads this via getState() directly.
   */
  setPlaybackStep(step: number): void {
    this.state = { ...this.state, playbackStep: step };
  }

  /** Toggle global automation playback */
  setPlaybackEnabled(enabled: boolean): void {
    this.state = { ...this.state, playbackEnabled: enabled };
    this.notify();
  }

  // Keep track of pending rAF to debounce UI updates for live values
  private _liveValuesRaf: number | null = null;

  /**
   * Update live automated values for UI display.
   * Called once per step tick with all values collected during that step.
   * Merges into existing map so stale entries remain visible until cleared.
   * Employs rAF coalescing to prevent main-thread UI contention.
   */
  setLiveValues(values: Record<string, number>): void {
    let changed = false;
    for (const key in values) {
      if (this.state.liveAutomatedValues[key] !== values[key]) {
        changed = true;
        break;
      }
    }
    if (!changed) return;

    const merged = Object.assign({}, this.state.liveAutomatedValues, values);
    this.state = { ...this.state, liveAutomatedValues: merged };

    // Coalesce React notify() into the next animation frame
    if (this._liveValuesRaf === null) {
      this._liveValuesRaf = requestAnimationFrame(() => {
        this.notify();
        this._liveValuesRaf = null;
      });
    }
  }

  /**
   * Clear all live automated values (e.g. when playback stops).
   * No-op if already empty.
   */
  clearLiveValues(): void {
    if (Object.keys(this.state.liveAutomatedValues).length === 0) return;
    this.state = { ...this.state, liveAutomatedValues: {} };
    if (this._liveValuesRaf !== null) {
      cancelAnimationFrame(this._liveValuesRaf);
      this._liveValuesRaf = null;
    }
    this.notify();
  }

  /**
   * Get the interpolated value for a lane at a given step.
   * Returns null if no points cover that step.
   */
  getValueAtStep(lane: UnifiedAutomationLane, step: number): number | null {
    return interpolateLaneAtStep(lane, step);
  }

  // --------------------------------------------------------------------------
  // Serialization (for song save/load)
  // --------------------------------------------------------------------------

  /** Export lanes for saving in SavedSongData */
  exportLanes(): UnifiedAutomationLane[] {
    return this.state.lanes.map((lane) => ({ ...lane }));
  }

  /** Import lanes from saved song data */
  importLanes(lanes: UnifiedAutomationLane[]): void {
    this.state = {
      ...this.state,
      lanes: lanes.map((l) => ({ ...l })),
    };
    this.notify();
  }

  /** Import lanes from RBS HyphonAutomationLanes */
  importFromRbs(hyphonLanes: HyphonAutomationLane[], patternIndex?: number): void {
    const converted = convertHyphonLanes(hyphonLanes, patternIndex);
    this.addLanes(converted);
  }

  // --------------------------------------------------------------------------
  // Reset
  // --------------------------------------------------------------------------

  /** Full reset to initial state */
  reset(): void {
    this.state = createInitialState();
    this.notify();
  }
}

// Singleton instance
export const automationStore = new AutomationStore();

// ============================================================================
// React Hook
// ============================================================================

/**
 * React hook for consuming automation state in components.
 */
export function useAutomationStore(): AutomationState {
  const [state, setState] = React.useState<AutomationState>(automationStore.getState());

  React.useEffect(() => {
    return automationStore.subscribe(setState);
  }, []);

  return state;
}
