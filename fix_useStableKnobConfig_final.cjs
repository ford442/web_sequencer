const fs = require('fs');

const content = `import { useState, useMemo, useEffect } from 'react';
import type { KnobConfig } from '../components/HardwareModule';

export function useStableKnobConfig<T>(
    generator: (params: T) => KnobConfig[],
    params: T
): KnobConfig[] {
    const [prevConfigs, setPrevConfigs] = useState<KnobConfig[] | null>(null);

    const mergedConfigs = useMemo(() => {
        const newConfigs = generator(params);

        if (!prevConfigs || newConfigs.length !== prevConfigs.length) {
            return newConfigs;
        }

        return newConfigs.map((newCfg, i) => {
            const oldCfg = prevConfigs[i];

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
    }, [params, generator, prevConfigs]);

    useEffect(() => {
        setPrevConfigs(mergedConfigs);
    }, [mergedConfigs]);

    return mergedConfigs;
}
`;

fs.writeFileSync('src/hooks/useStableKnobConfig.ts', content);
