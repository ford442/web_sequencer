import type { SamplerBankParams } from '../../types';

export function getSyncedSeconds(bars: number, bpm: number): number {
    if (!bars || bars <= 0) return 0;
    return bars * 4 * (60 / bpm);
}

export function getSyncedLfoHz(bars: number, bpm: number): number {
    if (!bars || bars <= 0) return 0;
    return bpm / (240 * bars);
}

type ResolvedExpressiveness = {
    vibratoRate: number;
    vibratoDepth: number;
    tremoloDepth: number;
    breathAmount: number;
};

export const resolveExpressiveness = (params: SamplerBankParams): ResolvedExpressiveness => {
    const cfg = params.expressiveness;
    const normalizeDepth = (value: number | undefined) => {
        if (value === undefined) return 0;
        return value > 1 ? value / 100 : value;
    };
    return {
        vibratoRate: cfg?.vibratoRate ?? 5.5,
        vibratoDepth: normalizeDepth(cfg?.vibratoDepth ?? params.vibratoDepth),
        tremoloDepth: normalizeDepth(cfg?.tremoloDepth ?? params.tremoloDepth),
        breathAmount: cfg?.breathAmount ?? params.breathIntensity ?? 0,
    };
};
