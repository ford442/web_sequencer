import type { TransportSyncMode } from '../midi/clock/types';

export const TRANSPORT_SYNC_STORAGE_KEY = 'hyphon.transportSync';

export interface TransportSyncPrefs {
  mode: TransportSyncMode;
  inputDeviceId?: string | null;
  outputDeviceId?: string | null;
}

export const DEFAULT_TRANSPORT_SYNC_PREFS: TransportSyncPrefs = {
  mode: 'internal',
  inputDeviceId: null,
  outputDeviceId: null,
};

export function isTransportSyncMode(value: unknown): value is TransportSyncMode {
  return value === 'internal' || value === 'master' || value === 'slave';
}

export function getStoredTransportSyncPrefs(): TransportSyncPrefs {
  try {
    const raw = localStorage.getItem(TRANSPORT_SYNC_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_TRANSPORT_SYNC_PREFS };
    const parsed = JSON.parse(raw) as Partial<TransportSyncPrefs>;
    return {
      mode: isTransportSyncMode(parsed.mode) ? parsed.mode : 'internal',
      inputDeviceId: parsed.inputDeviceId ?? null,
      outputDeviceId: parsed.outputDeviceId ?? null,
    };
  } catch {
    return { ...DEFAULT_TRANSPORT_SYNC_PREFS };
  }
}

export function setStoredTransportSyncPrefs(prefs: TransportSyncPrefs): void {
  try {
    localStorage.setItem(TRANSPORT_SYNC_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* ignore */
  }
}
