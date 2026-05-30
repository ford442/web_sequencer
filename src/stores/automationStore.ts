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
  };
}

class AutomationStore {
  private state: AutomationState;
  private listeners: Set<AutomationListener> = new Set();

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

  /** Get lanes for a specific target and parameter */
  getLanesForParam(target: AutomationTarget, parameter: string): UnifiedAutomationLane[] {
    return this.state.lanes.filter(
      (l) => l.target === target && l.parameter === parameter
    );
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

  /**
   * Update live automated values for UI display.
   * Called once per step tick with all values collected during that step.
   * Merges into existing map so stale entries remain visible until cleared.
   */
  setLiveValues(values: Record<string, number>): void {
    const merged = Object.assign({}, this.state.liveAutomatedValues, values);
    this.state = { ...this.state, liveAutomatedValues: merged };
    this.notify();
  }

  /**
   * Clear all live automated values (e.g. when playback stops).
   * No-op if already empty.
   */
  clearLiveValues(): void {
    if (Object.keys(this.state.liveAutomatedValues).length === 0) return;
    this.state = { ...this.state, liveAutomatedValues: {} };
    this.notify();
  }

  /**
   * Get the interpolated value for a lane at a given step.
   * Returns null if no points cover that step.
   */
  getValueAtStep(lane: UnifiedAutomationLane, step: number): number | null {
    if (lane.points.length === 0) return null;

    // Exact match
    const exact = lane.points.find((p) => p.step === step);
    if (exact) return exact.value;

    // Find surrounding points
    let before: AutomationLanePoint | null = null;
    let after: AutomationLanePoint | null = null;

    for (const p of lane.points) {
      if (p.step <= step) before = p;
      if (p.step > step && !after) after = p;
    }

    if (!before && !after) return null;
    if (!before) return after!.value;
    if (!after) return before.value;

    // Interpolate based on mode
    const interp = before.interpolation || lane.interpolation;
    if (interp === 'step') {
      return before.value;
    }

    // Linear interpolation
    const t = (step - before.step) / (after.step - before.step);
    if (interp === 'linear') {
      return before.value + t * (after.value - before.value);
    }

    // Smooth interpolation: cubic Hermite (smoothstep) 3t² - 2t³
    // Provides ease-in/ease-out curve between points for natural knob movement
    const smoothT = t * t * (3 - 2 * t);
    return before.value + smoothT * (after.value - before.value);
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
