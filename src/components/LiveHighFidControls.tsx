import React, { memo } from 'react';
import {
    CANONICAL_HIGHFID_COEFFICIENTS,
    HIGHFID_COEFFICIENT_KEYS,
    type HighFidCoefficientKey,
    type HighFidCoefficients,
} from '../audio-worklets/liveHighFidCoefficients';
import { abFreezeSide, type LiveAbSettings } from '../engines/LiveHighFidAbPair';

const COEFFICIENT_LABELS: Record<HighFidCoefficientKey, { label: string; hint: string }> = {
    transistorMismatch: { label: 'Mismatch', hint: 'Transistor mismatch — spreads the four ladder poles' },
    decayCurve: { label: 'Decay crv', hint: 'Decay curve — reshapes the filter envelope (0 = exponential)' },
    accentCoupling: { label: 'Acc→cut', hint: 'Accent coupling — how far an accent opens the cutoff' },
    filterTracking: { label: 'Kbd track', hint: 'Filter tracking — cutoff follows the played note' },
};

interface LiveAbControlsProps {
    ab: LiveAbSettings;
    onChange: (ab: LiveAbSettings) => void;
}

/**
 * Live A/B (Phase L2): arm, flip between stock Open303 (A) and the live diode
 * ladder (B), or blend them — while the sequencer keeps running.
 */
export const LiveAbControls: React.FC<LiveAbControlsProps> = memo(({ ab, onChange }) => {
    const blendPct = Math.round(ab.mix * 100);
    const side = abFreezeSide(ab.mix);
    const flipClass = (active: boolean) =>
        `flex-1 px-1.5 py-1 text-[8px] font-bold uppercase tracking-wider rounded border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 ${
            active
                ? 'bg-amber-600 text-white border-amber-300'
                : 'bg-zinc-900 text-zinc-400 border-zinc-700 hover:text-zinc-200'
        }`;
    return (
        <div className="flex flex-col gap-1 mt-1 pt-1 border-t border-amber-500/20" role="group" aria-label="Live A/B">
            <button
                type="button"
                onClick={() => onChange({ ...ab, armed: !ab.armed })}
                aria-pressed={ab.armed}
                title="Play Stock Open303 and the live diode ladder from the same notes on separate buses"
                className={flipClass(ab.armed)}
            >
                A/B vs stock
            </button>
            {ab.armed && (
                <>
                    <div className="flex gap-1">
                        <button
                            type="button"
                            onClick={() => onChange({ ...ab, mix: 0 })}
                            aria-pressed={ab.mix === 0}
                            aria-label="Flip to A (Stock Open303)"
                            className={flipClass(ab.mix === 0)}
                        >
                            A · Stock
                        </button>
                        <button
                            type="button"
                            onClick={() => onChange({ ...ab, mix: 1 })}
                            aria-pressed={ab.mix === 1}
                            aria-label="Flip to B (live high-fidelity)"
                            className={flipClass(ab.mix === 1)}
                        >
                            B · Hi-Fi
                        </button>
                    </div>
                    <label className="flex items-center gap-1 text-[8px] font-mono text-amber-300/90">
                        <span className="shrink-0">Blend</span>
                        <input
                            type="range"
                            min={0}
                            max={100}
                            step={1}
                            value={blendPct}
                            onChange={(e) => onChange({ ...ab, mix: Number(e.target.value) / 100 })}
                            aria-label="A/B blend, stock to high-fidelity"
                            aria-valuetext={`${blendPct}% high-fidelity`}
                            className="flex-1 accent-amber-500"
                        />
                        <span className="w-7 text-right">{blendPct}%</span>
                    </label>
                    <p className="text-[8px] text-zinc-400 font-mono leading-snug" role="status">
                        Freeze records {side === 'highfid' ? 'B (high-fid)' : 'A (stock)'} · blends are not frozen
                    </p>
                </>
            )}
        </div>
    );
});

interface HighFidCoefficientControlsProps {
    /** Song-stored coefficients; undefined = canonical preset. */
    coefficients: HighFidCoefficients | undefined;
    onChange: (coefficients: HighFidCoefficients | undefined) => void;
}

/**
 * Editable diode-ladder coefficients (Phase L3). Moving a slider stores the
 * set on the song; "Canonical" drops it again so the song carries nothing.
 */
export const HighFidCoefficientControls: React.FC<HighFidCoefficientControlsProps> = memo(({ coefficients, onChange }) => {
    const current = coefficients ?? CANONICAL_HIGHFID_COEFFICIENTS;
    return (
        <details className="mt-1 pt-1 border-t border-amber-500/20 text-[8px] font-mono text-amber-300/90">
            <summary className="cursor-pointer select-none uppercase tracking-wider">
                Diode ladder {coefficients ? '· edited' : '· canonical'}
            </summary>
            <div className="flex flex-col gap-0.5 mt-1" role="group" aria-label="Diode-ladder coefficients">
                {HIGHFID_COEFFICIENT_KEYS.map((key) => {
                    const pct = Math.round(current[key] * 100);
                    return (
                        <label key={key} className="flex items-center gap-1" title={COEFFICIENT_LABELS[key].hint}>
                            <span className="w-12 shrink-0">{COEFFICIENT_LABELS[key].label}</span>
                            <input
                                type="range"
                                min={0}
                                max={100}
                                step={1}
                                value={pct}
                                onChange={(e) => onChange({ ...current, [key]: Number(e.target.value) / 100 })}
                                aria-label={COEFFICIENT_LABELS[key].hint}
                                className="flex-1 accent-amber-500"
                            />
                            <span className="w-6 text-right">{pct}</span>
                        </label>
                    );
                })}
                <button
                    type="button"
                    onClick={() => onChange(undefined)}
                    disabled={!coefficients}
                    className="self-end px-1.5 py-0.5 rounded border border-zinc-700 text-zinc-300 disabled:opacity-40 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
                >
                    Canonical
                </button>
                <p className="text-zinc-400 leading-snug" role="status">
                    {coefficients ? 'Saved with the song · freeze uses these' : 'Canonical preset · freeze and quality gates use it'}
                </p>
            </div>
        </details>
    );
});
