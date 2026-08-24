import { useEffect, useRef, useState } from 'react';
import { SupertonicService } from '../services/Supertonic';

interface TTSPreloaderState {
    manifest: boolean[] | null;
    isPreloading: boolean;
}

const TTS_READY_POLL_MS = 500;

/**
 * Schedules TTS ONNX warmup after Supertonic.init() completes (post audio boot).
 */
export const useTTSPreloader = (): TTSPreloaderState => {
    const [state, setState] = useState<TTSPreloaderState>({
        manifest: null,
        isPreloading: false,
    });
    const scheduledRef = useRef(false);

    useEffect(() => {
        const service = SupertonicService.getInstance();

        const runPreload = async () => {
            if (scheduledRef.current || !service.isServiceReady()) {
                return;
            }
            scheduledRef.current = true;
            setState(prev => ({ ...prev, isPreloading: true }));

            try {
                await service.preload();
            } catch (e) {
                if (import.meta.env.DEV) { console.warn('useTTSPreloader: preload failed (non-critical):', e); }
            } finally {
                setState({
                    manifest: service.getPreloadManifest(),
                    isPreloading: false,
                });
            }
        };

        void runPreload();

        const intervalId = window.setInterval(() => {
            if (!scheduledRef.current && service.isServiceReady()) {
                void runPreload();
                window.clearInterval(intervalId);
            }
        }, TTS_READY_POLL_MS);

        return () => {
            window.clearInterval(intervalId);
        };
    }, []);

    return state;
};
