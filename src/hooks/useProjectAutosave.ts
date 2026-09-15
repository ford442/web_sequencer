// Wires ProjectStore (OPFS/IndexedDB, no size cap, includes embedded samples
// and background image) into the app's boot/save/shutdown lifecycle:
//   - migrates a legacy `hyphon:autosave:v1` localStorage payload on first run
//   - detects an unclean previous shutdown and offers crash recovery
//   - autosaves the full song (debounced, samples included) once the audio
//     engine is initialized (sample decoding on restore needs it)
//   - reports storage failures via engineDegradationStore, the pattern this
//     repo already uses for degraded GPU/WASM/worklet subsystems
import { useCallback, useEffect, useRef, useState } from 'react';
import type { SavedSongData } from '../types';
import { projectStore, AUTOSAVE_PROJECT_ID, type ProjectFileBackend } from '../services/ProjectStore';
import { engineDegradationStore } from '../stores/engineDegradationStore';

const AUTOSAVE_INTERVAL_MS = 8_000;
const DEGRADATION_ID = 'project-store';

export interface UseProjectAutosaveDeps {
    getSongData: () => Promise<SavedSongData>;
    /** Sample decoding needs a live AudioContext, so autosave waits for it. */
    isInitialized: boolean;
    enabled?: boolean;
}

export interface UseProjectAutosaveReturn {
    /** True when the previous session did not shut down cleanly and a restorable project exists. */
    pendingRestore: boolean;
    /** Loads the autosaved project and clears pendingRestore. Caller applies it (e.g. loadCloudData). */
    restoreProject: () => Promise<SavedSongData | null>;
    dismissRestore: () => void;
    projectStoreBackend: ProjectFileBackend['kind'] | null;
}

function reportFailure(message: string, err: unknown): void {
    const reason = err instanceof Error ? err.message : String(err);
    engineDegradationStore.report({
        id: DEGRADATION_ID,
        subsystem: 'project-store',
        category: 'audio',
        message,
        reason,
        status: 'active',
        activeBackend: 'none',
        requestedBackend: 'opfs/idb',
        retryable: true,
    });
}

export function useProjectAutosave(deps: UseProjectAutosaveDeps): UseProjectAutosaveReturn {
    const { getSongData, isInitialized, enabled = true } = deps;
    const getSongDataRef = useRef(getSongData);
    getSongDataRef.current = getSongData;

    const [pendingRestore, setPendingRestore] = useState(false);
    const [backend, setBackend] = useState<ProjectFileBackend['kind'] | null>(null);
    const migratedRef = useRef(false);
    const lastSavedJsonRef = useRef<string | null>(null);

    // One-time boot sequence: migrate legacy localStorage autosave, detect a
    // crashed previous session, and ask the browser to persist this origin.
    useEffect(() => {
        if (!enabled || migratedRef.current) return;
        migratedRef.current = true;
        let cancelled = false;
        void (async () => {
            try {
                await projectStore.migrateLegacyAutosave();
                const clean = await projectStore.wasCleanShutdown(AUTOSAVE_PROJECT_ID);
                if (!cancelled && clean === false) setPendingRestore(true);
                void projectStore.requestPersistence();
                const kind = await projectStore.backendKind();
                if (!cancelled) setBackend(kind);
            } catch (err) {
                if (!cancelled) reportFailure('Project storage unavailable', err);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [enabled]);

    // Retry handler for the EngineDegradationBanner's "Retry" button.
    useEffect(() => {
        if (!enabled) return;
        return engineDegradationStore.registerRetryHandler(DEGRADATION_ID, async () => {
            const data = await getSongDataRef.current();
            const result = await projectStore.saveProject(AUTOSAVE_PROJECT_ID, data);
            if (!result.ok) throw new Error(result.error ?? 'Autosave failed');
            lastSavedJsonRef.current = JSON.stringify(data);
        });
    }, [enabled]);

    // Mark the session dirty at boot (implicit: every saveProject() call also
    // marks dirty) and clean again only when the page unloads gracefully.
    useEffect(() => {
        if (!enabled) return;
        const markClean = () => {
            void projectStore.markCleanShutdown(AUTOSAVE_PROJECT_ID);
        };
        window.addEventListener('pagehide', markClean);
        window.addEventListener('beforeunload', markClean);
        return () => {
            window.removeEventListener('pagehide', markClean);
            window.removeEventListener('beforeunload', markClean);
        };
    }, [enabled]);

    // Periodic debounced save — includes embedded samples and background
    // image (content-addressed, deduplicated by ProjectStore), unlike the
    // legacy localStorage autosave which stripped both and capped at 512 KB.
    useEffect(() => {
        if (!enabled || !isInitialized) return;
        let cancelled = false;
        let saving = false;
        const timer = setInterval(() => {
            if (saving) return;
            saving = true;
            void (async () => {
                try {
                    const data = await getSongDataRef.current();
                    const json = JSON.stringify(data);
                    if (json === lastSavedJsonRef.current) return;
                    const result = await projectStore.saveProject(AUTOSAVE_PROJECT_ID, data);
                    if (cancelled) return;
                    if (result.ok) {
                        lastSavedJsonRef.current = json;
                        engineDegradationStore.resolve(DEGRADATION_ID);
                    } else {
                        reportFailure('Autosave failed', new Error(result.error ?? 'unknown error'));
                    }
                } catch (err) {
                    if (!cancelled) reportFailure('Autosave failed', err);
                } finally {
                    saving = false;
                }
            })();
        }, AUTOSAVE_INTERVAL_MS);
        return () => {
            cancelled = true;
            clearInterval(timer);
        };
    }, [enabled, isInitialized]);

    const restoreProject = useCallback(async () => {
        const data = await projectStore.loadProject(AUTOSAVE_PROJECT_ID);
        setPendingRestore(false);
        return data;
    }, []);

    const dismissRestore = useCallback(() => setPendingRestore(false), []);

    return { pendingRestore, restoreProject, dismissRestore, projectStoreBackend: backend };
}
