/**
 * UI Modals Store
 *
 * External, `useSyncExternalStore`-backed home for the app's modal /
 * overlay visibility flags (voice editor, cloud library, AI song modal,
 * RBS import, export, lyric track, shortcuts help, gamepad debugger,
 * generating spinner, the "has the user pressed start" flag, the
 * ScriptProcessor fallback toggle, 3D mode, and the toast banner).
 *
 * These flags used to live as ~13 separate `useState` calls inside
 * `useAppState()`, which meant every one of them was folded into the single
 * object handed to `AppStateContext` — so flipping any of them (or any of
 * the other ~90 fields in that object) re-rendered every context consumer.
 * Moving them here lets a component subscribe to exactly the flag it cares
 * about via `useUIModalsStore(selector)`, independent of anything else in
 * the app's state.
 *
 * `useUIModalsState()` (src/hooks/appState/useUIModalsState.ts) still wraps
 * this store so `useAppState()` and `AppStateContext` keep working
 * unchanged for consumers that haven't migrated off the shared context yet.
 *
 * @see docs/PERFORMANCE_BUDGET.md
 */

import { useSyncExternalStore } from 'react';

export type ToastType = 'success' | 'error' | 'info';

export interface ToastMessage {
  message: string;
  type: ToastType;
}

export interface UIModalsState {
  isVoiceEditorOpen: boolean;
  isCloudLibraryOpen: boolean;
  isAISongModalOpen: boolean;
  isRbsImportModalOpen: boolean;
  isSmfImportModalOpen: boolean;
  isExportModalOpen: boolean;
  isLyricTrackVisible: boolean;
  isShortcutsHelpOpen: boolean;
  showGamepadDebug: boolean;
  isGenerating: boolean;
  hasStarted: boolean;
  forceScriptProcessorFallback: boolean;
  is3DMode: boolean;
  toast: ToastMessage | null;
}

type Listener = () => void;
type BoolKey = Exclude<keyof UIModalsState, 'toast'>;
type BoolAction = boolean | ((prev: boolean) => boolean);

function loadForceScriptProcessorFallback(): boolean {
  if (typeof localStorage === 'undefined') return false;
  return localStorage.getItem('forceScriptProcessorFallback') === 'true';
}

function createInitialState(): UIModalsState {
  return {
    isVoiceEditorOpen: false,
    isCloudLibraryOpen: false,
    isAISongModalOpen: false,
    isRbsImportModalOpen: false,
    isSmfImportModalOpen: false,
    isExportModalOpen: false,
    isLyricTrackVisible: false,
    isShortcutsHelpOpen: false,
    showGamepadDebug: false,
    isGenerating: false,
    hasStarted: false,
    forceScriptProcessorFallback: loadForceScriptProcessorFallback(),
    is3DMode: false,
    toast: null,
  };
}

const BOOL_KEYS: BoolKey[] = [
  'isVoiceEditorOpen',
  'isCloudLibraryOpen',
  'isAISongModalOpen',
  'isRbsImportModalOpen',
  'isSmfImportModalOpen',
  'isExportModalOpen',
  'isLyricTrackVisible',
  'isShortcutsHelpOpen',
  'showGamepadDebug',
  'isGenerating',
  'hasStarted',
  'forceScriptProcessorFallback',
  'is3DMode',
];

class UIModalsStore {
  private state: UIModalsState = createInitialState();
  private listeners = new Set<Listener>();

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): UIModalsState => this.state;

  private notify(): void {
    this.listeners.forEach((listener) => listener());
  }

  private setBool(key: BoolKey, action: BoolAction): void {
    const prev = this.state[key];
    const next = typeof action === 'function' ? (action as (p: boolean) => boolean)(prev) : action;
    if (next === prev) return;
    this.state = { ...this.state, [key]: next };
    this.notify();
  }

  setIsVoiceEditorOpen = (v: BoolAction): void => this.setBool('isVoiceEditorOpen', v);
  setIsCloudLibraryOpen = (v: BoolAction): void => this.setBool('isCloudLibraryOpen', v);
  setIsAISongModalOpen = (v: BoolAction): void => this.setBool('isAISongModalOpen', v);
  setIsRbsImportModalOpen = (v: BoolAction): void => this.setBool('isRbsImportModalOpen', v);
  setIsSmfImportModalOpen = (v: BoolAction): void => this.setBool('isSmfImportModalOpen', v);
  setIsExportModalOpen = (v: BoolAction): void => this.setBool('isExportModalOpen', v);
  setIsLyricTrackVisible = (v: BoolAction): void => this.setBool('isLyricTrackVisible', v);
  setIsShortcutsHelpOpen = (v: BoolAction): void => this.setBool('isShortcutsHelpOpen', v);
  setShowGamepadDebug = (v: BoolAction): void => this.setBool('showGamepadDebug', v);
  setIsGenerating = (v: BoolAction): void => this.setBool('isGenerating', v);
  setHasStarted = (v: BoolAction): void => this.setBool('hasStarted', v);
  setIs3DMode = (v: BoolAction): void => this.setBool('is3DMode', v);

  setForceScriptProcessorFallback = (v: BoolAction): void => {
    const prev = this.state.forceScriptProcessorFallback;
    const next = typeof v === 'function' ? (v as (p: boolean) => boolean)(prev) : v;
    if (next === prev) return;
    this.state = { ...this.state, forceScriptProcessorFallback: next };
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('forceScriptProcessorFallback', String(next));
    }
    this.notify();
  };

  setToast = (toast: ToastMessage | null | ((prev: ToastMessage | null) => ToastMessage | null)): void => {
    const next = typeof toast === 'function' ? toast(this.state.toast) : toast;
    if (next === this.state.toast) return;
    this.state = { ...this.state, toast: next };
    this.notify();
  };

  showToast = (message: string, type: ToastType = 'success'): void => {
    this.setToast({ message, type });
  };

  /** Full reset to initial state (used in tests). */
  reset = (): void => {
    this.state = createInitialState();
    this.notify();
  };
}

export const uiModalsStore = new UIModalsStore();

// Re-export for callers that want to iterate every boolean flag (e.g. tests).
export { BOOL_KEYS as UI_MODALS_BOOL_KEYS };

const identitySelector = (state: UIModalsState): UIModalsState => state;

/**
 * Subscribe to the UI modals store. Pass a selector to subscribe to just the
 * slice you need — e.g. `useUIModalsStore(s => s.is3DMode)` — so the
 * component only re-renders when that value actually changes, regardless of
 * what else changes elsewhere in the app.
 */
export function useUIModalsStore<T = UIModalsState>(
  selector: (state: UIModalsState) => T = identitySelector as unknown as (state: UIModalsState) => T,
): T {
  return useSyncExternalStore(
    uiModalsStore.subscribe,
    () => selector(uiModalsStore.getSnapshot()),
  );
}
