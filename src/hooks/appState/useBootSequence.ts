import { useCallback, useState } from 'react'
import { log } from '@/utils/log'
import { SupertonicService } from '../../services/Supertonic'
import { loadingProgressStore } from '../../stores/loadingProgressStore'
import { reportTtsAvailability } from '../../services/ttsAvailability'

/** How long the INITIALIZING overlay waits on a hung engine init before showing the UI. */
const INIT_GIVE_UP_MS = 45_000;

/**
 * INITIALIZE SYSTEM: start the audio engine (never blocking the UI on a hung
 * worklet), then TTS in the background. Moved out of `useAppState()`
 * unchanged (#1597 P2 split).
 */
export function useBootSequence(deps: {
    initializeAudio: () => Promise<void>;
    setHasStarted: (started: boolean) => void;
}) {
    const { initializeAudio, setHasStarted } = deps;
    const [isInitialized, setIsInitialized] = useState(false);

    const handleStart = useCallback(async () => {
        log.debug("Initialization sequence started...");
        setHasStarted(true);
        try {
            // WebKit can hang inside AudioWorklet addModule; don't leave the
            // INITIALIZING overlay up forever (Playwright then waits 120s).
            await Promise.race([
                initializeAudio(),
                new Promise<void>((resolve) => {
                    window.setTimeout(() => {
                        // Say so: a hung init step otherwise looks like a booted
                        // engine that never plays (#1492).
                        const { isLoading, currentStep } = loadingProgressStore.getState();
                        if (isLoading) {
                            console.warn(
                                `[Boot] audio engine init still pending after 45 s (step: ${currentStep ?? 'unknown'}); ` +
                                'showing the UI anyway — playback waits for the engine',
                            );
                        }
                        resolve();
                    }, INIT_GIVE_UP_MS);
                }),
            ]);
        } catch (e) {
            console.error("Failed to start system:", e);
        } finally {
            setIsInitialized(true);
            log.debug("Audio Engine Initialized");
        }
        loadingProgressStore.startStep('ttsEngine');
        void SupertonicService.getInstance().init().then(() => {
            reportTtsAvailability(SupertonicService.getInstance().getUnavailableReason());
        }).catch((e: unknown) => {
            console.warn('Supertonic TTS failed to init:', e);
            loadingProgressStore.failStep('ttsEngine', e instanceof Error ? e : new Error(String(e)), true);
        });
    }, [initializeAudio, setHasStarted]);

    return { isInitialized, setIsInitialized, handleStart };
}
