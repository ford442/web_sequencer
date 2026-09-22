import { useMemo, useState } from 'react';
import type { KnobConfig } from '../components/HardwareModule';

function sameKnobConfig(a: KnobConfig, b: KnobConfig): boolean {
    return a.id === b.id &&
        a.value === b.value &&
        a.x === b.x &&
        a.y === b.y &&
        a.size === b.size &&
        a.label === b.label &&
        a.isRecording === b.isRecording &&
        a.valueDisplay === b.valueDisplay;
}

export function useStableKnobConfig<T>(
    generator: (params: T) => KnobConfig[],
    params: T
): KnobConfig[] {
    const [stableConfigs, setStableConfigs] = useState<KnobConfig[]>(() => generator(params));

    // Reuse unchanged config objects so memoised knobs skip re-rendering.
    // Adjusting our own state during render (rather than in an effect) commits
    // the merged result immediately instead of cascading an extra render.
    const newConfigs = useMemo(() => generator(params), [generator, params]);
    const merged = newConfigs.map((cfg, i) => {
        const old = stableConfigs[i];
        return old && sameKnobConfig(old, cfg) ? old : cfg;
    });
    const hasChanged =
        merged.length !== stableConfigs.length || merged.some((cfg, i) => cfg !== stableConfigs[i]);

    if (hasChanged) {
        setStableConfigs(merged);
        return merged;
    }
    return stableConfigs;
}
