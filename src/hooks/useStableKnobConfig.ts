import { useRef, useMemo } from 'react';
import type { KnobConfig } from '../components/HardwareModule';

export function useStableKnobConfig<T>(
    generator: (params: T) => KnobConfig[],
    params: T
): KnobConfig[] {
    // We use null to indicate initialization needed
    const prevConfigs = useRef<KnobConfig[] | null>(null);

    return useMemo(() => {
         const newConfigs = generator(params);
         const oldConfigs = prevConfigs.current;

         // If first run or length changed (layout change), return new entirely
         if (!oldConfigs || newConfigs.length !== oldConfigs.length) {
             prevConfigs.current = newConfigs;
             return newConfigs;
         }

         const mergedConfigs = newConfigs.map((newCfg, i) => {
             const oldCfg = oldConfigs[i];

             // Check if all primitive properties match.
             // If so, reuse the old object reference.
             if (oldCfg.id === newCfg.id &&
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

         prevConfigs.current = mergedConfigs;
         return mergedConfigs;
    }, [params, generator]);
}
