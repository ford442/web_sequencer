import { useState } from 'react';
import type { KnobConfig } from '../components/HardwareModule';

export function useStableKnobConfig<T>(
    generator: (params: T) => KnobConfig[],
    params: T
): KnobConfig[] {
    const [stableConfigs, setStableConfigs] = useState<KnobConfig[]>(() => generator(params));

    const newConfigs = generator(params);

    if (!stableConfigs || newConfigs.length !== stableConfigs.length) {
        setStableConfigs(newConfigs);
        return newConfigs;
    }

    const mergedConfigs = newConfigs.map((newCfg, i) => {
        const oldCfg = stableConfigs[i];

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
        if (mergedConfigs[i] !== stableConfigs[i]) {
            hasChanged = true;
            break;
        }
    }

    if (hasChanged) {
        setStableConfigs(mergedConfigs);
        return mergedConfigs;
    }

    return stableConfigs;
}
