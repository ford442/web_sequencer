import { useSyncExternalStore } from 'react';
import { HYPHON_NATIVE_READY_EVENT, isHyphonNativeReady } from '../engines/hyphonNativeProbe';

function subscribe(onChange: () => void): () => void {
    window.addEventListener(HYPHON_NATIVE_READY_EVENT, onChange);
    return () => window.removeEventListener(HYPHON_NATIVE_READY_EVENT, onChange);
}

/** True once main.tsx's probe has found and validated the voice wasm. */
export function useHyphonNativeReady(): boolean {
    return useSyncExternalStore(subscribe, isHyphonNativeReady, () => false);
}
