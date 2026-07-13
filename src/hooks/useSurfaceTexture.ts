import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

export type SurfaceTexture = 'off' | 'grain' | 'circuit';

const STORAGE_KEY = 'hyphon-surface-texture';

const BODY_CLASSES: Record<SurfaceTexture, string> = {
  off: '',
  grain: 'hyphon-texture-grain',
  circuit: 'hyphon-texture-circuit',
};

function readStoredTexture(): SurfaceTexture {
  if (typeof localStorage === 'undefined') return 'off';
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw === 'grain' || raw === 'circuit') return raw;
  return 'off';
}

function applyBodyTexture(texture: SurfaceTexture) {
  if (typeof document === 'undefined') return;
  const body = document.body;
  body.classList.remove('hyphon-texture-grain', 'hyphon-texture-circuit');
  const cls = BODY_CLASSES[texture];
  if (cls) body.classList.add(cls);
}

let currentTexture: SurfaceTexture = readStoredTexture();
const listeners = new Set<() => void>();

function emitTextureChange() {
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): SurfaceTexture {
  return currentTexture;
}

function setGlobalTexture(next: SurfaceTexture) {
  currentTexture = next;
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, next);
  }
  applyBodyTexture(next);
  emitTextureChange();
}

/** Optional film-grain / circuit overlay toggle (CSS-only, perf-conscious). */
export function useSurfaceTexture() {
  const texture = useSyncExternalStore(subscribe, getSnapshot, () => 'off' as SurfaceTexture);

  useEffect(() => {
    applyBodyTexture(texture);
  }, [texture]);

  const setTexture = useCallback((next: SurfaceTexture) => {
    setGlobalTexture(next);
  }, []);

  const cycleTexture = useCallback(() => {
    setGlobalTexture(texture === 'off' ? 'grain' : texture === 'grain' ? 'circuit' : 'off');
  }, [texture]);

  return { texture, setTexture, cycleTexture };
}
