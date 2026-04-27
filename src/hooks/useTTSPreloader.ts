import { useEffect, useRef, useState } from 'react';
import { SupertonicService } from '../services/Supertonic';

interface TTSPreloaderState {
    manifest: boolean[] | null;
    isPreloading: boolean;
}

export const useTTSPreloader = (): TTSPreloaderState => {
    const [state, setState] = useState<TTSPreloaderState>({
        manifest: null,
        isPreloading: false,
    });
    const scheduledRef = useRef(false);

    useEffect(() => {
        const service = SupertonicService.getInstance();
        if (!service.isServiceReady() || scheduledRef.current) {
            return;
        }

        scheduledRef.current = true;
        setState(prev => ({ ...prev, isPreloading: true }));

        const runPreload = async () => {
            try {
                await service.preload();
            } catch (e) {
                console.warn('useTTSPreloader: preload failed (non-critical):', e);
            } finally {
                setState({
                    manifest: service.getPreloadManifest(),
                    isPreloading: false,
                });
            }
        };

        if (typeof requestIdleCallback !== 'undefined') {
            const id = requestIdleCallback(runPreload, { timeout: 2000 });
            return () => {
                cancelIdleCallback(id);
            };
        } else {
            const timeoutId = setTimeout(runPreload, 200);
            return () => {
                clearTimeout(timeoutId);
            };
        }
    }, []);

    return state;
};
