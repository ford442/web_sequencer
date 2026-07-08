/**
 * MIDI Learn / mapping store.
 * User prefs persist in localStorage; song-level mappings ride in SavedSongData.
 */

import React from 'react';
import type { MidiBinding, MidiControlId, MidiMessageKey } from '../types/midi';
import { midiKeyToString } from '../types/midi';

const USER_PREFS_KEY = 'hyphon-midi-mappings';

export interface MidiMapState {
  learnMode: boolean;
  /** Last UI control touched while learn mode is active (or via long-press). */
  lastTouchedControl: MidiControlId | null;
  mappings: MidiBinding[];
  /** Controls currently receiving MIDI (for activity flash). */
  activeControls: Record<MidiControlId, number>;
  /** Web MIDI available and at least one input connected. */
  inputAvailable: boolean;
  connectedInputs: string[];
  /** Panel visibility */
  panelOpen: boolean;
}

type MidiMapListener = (state: MidiMapState) => void;

function loadUserMappings(): MidiBinding[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(USER_PREFS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveUserMappings(mappings: MidiBinding[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(USER_PREFS_KEY, JSON.stringify(mappings));
  } catch {
    // Quota or private browsing — ignore
  }
}

function createInitialState(): MidiMapState {
  return {
    learnMode: false,
    lastTouchedControl: null,
    mappings: loadUserMappings(),
    activeControls: {},
    inputAvailable: false,
    connectedInputs: [],
    panelOpen: false,
  };
}

class MidiMapStore {
  private state: MidiMapState = createInitialState();
  private listeners = new Set<MidiMapListener>();
  private activityTimers = new Map<MidiControlId, ReturnType<typeof setTimeout>>();

  getState(): MidiMapState {
    return this.state;
  }

  subscribe(listener: MidiMapListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    this.listeners.forEach((l) => l(this.state));
  }

  private setState(patch: Partial<MidiMapState>): void {
    this.state = { ...this.state, ...patch };
    this.notify();
  }

  setLearnMode(enabled: boolean): void {
    this.setState({
      learnMode: enabled,
      lastTouchedControl: enabled ? this.state.lastTouchedControl : null,
    });
  }

  toggleLearnMode(): void {
    this.setLearnMode(!this.state.learnMode);
  }

  setPanelOpen(open: boolean): void {
    this.setState({ panelOpen: open });
  }

  touchControl(controlId: MidiControlId): void {
    this.setState({ lastTouchedControl: controlId });
  }

  setInputAvailable(available: boolean, names: string[] = []): void {
    this.setState({ inputAvailable: available, connectedInputs: names });
  }

  /** Merge song mappings over user prefs (song wins on duplicate keys). */
  importSongMappings(songMappings: MidiBinding[] | undefined): void {
    const user = loadUserMappings();
    const merged = mergeBindings(user, songMappings ?? []);
    this.setState({ mappings: merged });
  }

  /** Export current mappings for song save. */
  exportMappings(): MidiBinding[] {
    return this.state.mappings.map((m) => ({ ...m }));
  }

  addBinding(binding: MidiBinding): void {
    const keyStr = midiKeyToString(binding.key);
    const next = this.state.mappings.filter((m) => midiKeyToString(m.key) !== keyStr);
    next.push(binding);
    this.setState({ mappings: next });
    saveUserMappings(next);
  }

  removeBinding(key: MidiMessageKey, deviceId?: string): void {
    const keyStr = midiKeyToString(key);
    const next = this.state.mappings.filter(
      (m) => midiKeyToString(m.key) !== keyStr || m.deviceId !== deviceId,
    );
    this.setState({ mappings: next });
    saveUserMappings(next);
  }

  clearBindingsForControl(controlId: MidiControlId): void {
    const next = this.state.mappings.filter((m) => m.controlId !== controlId);
    this.setState({ mappings: next });
    saveUserMappings(next);
  }

  clearAllBindings(): void {
    this.setState({ mappings: [] });
    saveUserMappings([]);
  }

  findBinding(key: MidiMessageKey, deviceId?: string): MidiBinding | undefined {
    const keyStr = midiKeyToString(key);
    const exact = this.state.mappings.find(
      (m) => midiKeyToString(m.key) === keyStr && (!m.deviceId || m.deviceId === deviceId),
    );
    if (exact) return exact;
    return this.state.mappings.find((m) => midiKeyToString(m.key) === keyStr && !m.deviceId);
  }

  isControlMapped(controlId: MidiControlId): boolean {
    return this.state.mappings.some((m) => m.controlId === controlId);
  }

  flashControl(controlId: MidiControlId): void {
    const prev = this.activityTimers.get(controlId);
    if (prev) clearTimeout(prev);
    this.setState({
      activeControls: { ...this.state.activeControls, [controlId]: Date.now() },
    });
    const timer = setTimeout(() => {
      const { [controlId]: _, ...rest } = this.state.activeControls;
      this.setState({ activeControls: rest as Record<MidiControlId, number> });
      this.activityTimers.delete(controlId);
    }, 120);
    this.activityTimers.set(controlId, timer);
  }

  reset(): void {
    this.activityTimers.forEach((t) => clearTimeout(t));
    this.activityTimers.clear();
    this.state = createInitialState();
    this.notify();
  }
}

function mergeBindings(base: MidiBinding[], overrides: MidiBinding[]): MidiBinding[] {
  const map = new Map<string, MidiBinding>();
  for (const b of base) {
    map.set(`${midiKeyToString(b.key)}|${b.deviceId ?? ''}`, b);
  }
  for (const b of overrides) {
    map.set(`${midiKeyToString(b.key)}|${b.deviceId ?? ''}`, b);
  }
  return Array.from(map.values());
}

export const midiMapStore = new MidiMapStore();

export function useMidiMapStore(): MidiMapState {
  const [state, setState] = React.useState<MidiMapState>(midiMapStore.getState());
  React.useEffect(() => midiMapStore.subscribe(setState), []);
  return state;
}
