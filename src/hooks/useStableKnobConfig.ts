import { useState, useEffect, useRef } from 'react';
import type { KnobConfig } from '../components/HardwareModule';

export function useStableKnobConfig<T>(
    generator: (params: T) => KnobConfig[],
    params: T
): KnobConfig[] {
    const [stableConfigs, setStableConfigs] = useState<KnobConfig[]>(() => generator(params));
    const prevRef = useRef(stableConfigs);

    // Keep ref in sync with the latest stable state without causing effect loops
    useEffect(() => {
        prevRef.current = stableConfigs;
    });

    // Compare and update state in an effect to avoid render-phase setState
    useEffect(() => {
        const newConfigs = generator(params);
        const prev = prevRef.current;

        if (!prev || newConfigs.length !== prev.length) {
            setStableConfigs(newConfigs);
            return;
        }

        const mergedConfigs = newConfigs.map((newCfg, i) => {
            const oldCfg = prev[i];

            if (oldCfg &&
                oldCfg.id === newCfg.id &&
                oldCfg.value === newCfg.value &&
                oldCfg.x === newCfg.x &&
                oldCfg.y === newCfg.y &&
                oldCfg.size === newCfg.size &&
                oldCfg.label === newCfg.label &&
                oldCfg.isRecording === newCfg.isRecording &&
                oldCfg.valueDisplay === newCfg.valueDisplay) {
                return oldCfg;
            }
            return newCfg;
        });

        let hasChanged = false;
        for (let i = 0; i < mergedConfigs.length; i++) {
            if (mergedConfigs[i] !== prev[i]) {
                hasChanged = true;
                break;
            }
        }

        if (hasChanged) {
            setStableConfigs(mergedConfigs);
        }
    }, [params, generator]);

    return stableConfigs;
}
