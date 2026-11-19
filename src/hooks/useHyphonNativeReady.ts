import { useSyncExternalStore } from 'react';
import {
    getHyphonNativeStatus,
    HYPHON_NATIVE_FAILED_EVENT,
    HYPHON_NATIVE_READY_EVENT,
    type HyphonNativeStatus,
} from '../engines/hyphonNativeProbe';

function subscribe(onChange: () => void): () => void {
    window.addEventListener(HYPHON_NATIVE_READY_EVENT, onChange);
    window.addEventListener(HYPHON_NATIVE_FAILED_EVENT, onChange);
    return () => {
        window.removeEventListener(HYPHON_NATIVE_READY_EVENT, onChange);
        window.removeEventListener(HYPHON_NATIVE_FAILED_EVENT, onChange);
    };
}

/** `pending` until the probe settles; `failed` means the JS fallbacks are the active engines. */
export function useHyphonNativeStatus(): HyphonNativeStatus {
    return useSyncExternalStore(subscribe, getHyphonNativeStatus, () => 'pending');
}
