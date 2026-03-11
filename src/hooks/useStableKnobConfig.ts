import { useRef, useMemo } from 'react';
import type { KnobConfig } from '../components/HardwareModule';

export function useStableKnobConfig<T>(
    generator: (params: T) => KnobConfig[],
    params: T
): KnobConfig[] {
    const prevConfigsRef = useRef<KnobConfig[] | null>(null);

    const mergedConfigs = useMemo(() => {
        const newConfigs = generator(params);
        const prevConfigs = prevConfigsRef.current;

        if (!prevConfigs || newConfigs.length !== prevConfigs.length) {
            prevConfigsRef.current = newConfigs;
            return newConfigs;
        }

        const nextConfigs = newConfigs.map((newCfg, i) => {
            const oldCfg = prevConfigs[i];

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

        prevConfigsRef.current = nextConfigs;
        return nextConfigs;
    }, [params, generator]);

    return mergedConfigs;
}
