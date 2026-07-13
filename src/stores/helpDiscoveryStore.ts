import { useSyncExternalStore } from 'react';
import { HELP_WHATS_NEW_VERSION } from '../content/helpTopics';

export type HelpModalTab = 'shortcuts' | 'guides' | 'search';

export interface HelpOpenRequest {
  tab: HelpModalTab;
  topicId?: string;
  searchQuery?: string;
}

interface HelpDiscoveryState {
  seenTipIds: string[];
  whatsNewDismissedVersion: string | null;
  helpOpen: boolean;
  openRequest: HelpOpenRequest | null;
}

const STORAGE_KEY = 'hyphon-help-discovery';

function loadState(): HelpDiscoveryState {
  const defaults: HelpDiscoveryState = {
    seenTipIds: [],
    whatsNewDismissedVersion: null,
    helpOpen: false,
    openRequest: null,
  };
  if (typeof localStorage === 'undefined') return defaults;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<HelpDiscoveryState>;
    return {
      ...defaults,
      seenTipIds: Array.isArray(parsed.seenTipIds) ? parsed.seenTipIds : [],
      whatsNewDismissedVersion:
        typeof parsed.whatsNewDismissedVersion === 'string'
          ? parsed.whatsNewDismissedVersion
          : null,
    };
  } catch {
    return defaults;
  }
}

let state: HelpDiscoveryState = loadState();
const listeners = new Set<() => void>();

function persist() {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      seenTipIds: state.seenTipIds,
      whatsNewDismissedVersion: state.whatsNewDismissedVersion,
    }),
  );
}

function emit() {
  listeners.forEach((l) => l());
}

function setState(patch: Partial<HelpDiscoveryState>) {
  state = { ...state, ...patch };
  if ('seenTipIds' in patch || 'whatsNewDismissedVersion' in patch) {
    persist();
  }
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return state;
}

export const helpDiscoveryStore = {
  getState: getSnapshot,

  openHelp(request: HelpOpenRequest = { tab: 'search' }) {
    setState({ helpOpen: true, openRequest: request });
  },

  closeHelp() {
    setState({ helpOpen: false, openRequest: null });
  },

  consumeOpenRequest(): HelpOpenRequest | null {
    const req = state.openRequest;
    if (req) setState({ openRequest: null });
    return req;
  },

  markTipSeen(tipId: string) {
    if (state.seenTipIds.includes(tipId)) return;
    setState({ seenTipIds: [...state.seenTipIds, tipId] });
  },

  hasSeenTip(tipId: string) {
    return state.seenTipIds.includes(tipId);
  },

  dismissWhatsNew() {
    setState({ whatsNewDismissedVersion: HELP_WHATS_NEW_VERSION });
  },

  shouldShowWhatsNew() {
    return state.whatsNewDismissedVersion !== HELP_WHATS_NEW_VERSION;
  },

  /** Test-only reset */
  _resetForTests() {
    state = {
      seenTipIds: [],
      whatsNewDismissedVersion: null,
      helpOpen: false,
      openRequest: null,
    };
    if (typeof localStorage !== 'undefined') localStorage.removeItem(STORAGE_KEY);
    emit();
  },
};

export function useHelpDiscoveryStore() {
  return useSyncExternalStore(subscribe, getSnapshot, () => loadState());
}
