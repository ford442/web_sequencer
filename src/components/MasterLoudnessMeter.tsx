// MasterLoudnessMeter — broadcast-style master strip.
//
// Shows momentary / short-term / integrated LUFS, held true peak, a gain
// reduction bar and the limiter controls (ceiling, bypass, monitor-only).
// Values arrive as scalars from the master worklet at ≤ 30 Hz; this component
// never touches an AudioNode.

import React, { memo, useCallback } from 'react';

import { useMasterLoudness } from '../hooks/useMasterLoudness';
import { formatLufs, LOUDNESS_TARGETS } from '../audio/loudness';

interface MasterLoudnessMeterProps {
    className?: string;
    /** Reference loudness drawn as the target marker. Default -14 (streaming). */
    targetLufs?: number;
}

/** Map a loudness value onto a 0-1 scale spanning -40…0 LUFS. */
function loudnessToFraction(lufs: number): number {
    if (!Number.isFinite(lufs)) return 0;
    return Math.max(0, Math.min(1, (lufs + 40) / 40));
}

const READOUT_CLASS = 'font-mono text-[11px] leading-none tabular-nums';

interface ReadoutProps {
    label: string;
    value: number;
    title: string;
    highlight?: boolean;
}

const Readout: React.FC<ReadoutProps> = ({ label, value, title, highlight }) => (
    <div className="flex flex-col items-center gap-0.5" title={title}>
        <span className="text-[9px] uppercase tracking-wide text-neutral-400">{label}</span>
        <span className={`${READOUT_CLASS} ${highlight ? 'text-amber-300' : 'text-neutral-100'}`}>
            {formatLufs(value)}
        </span>
    </div>
);

export const MasterLoudnessMeter: React.FC<MasterLoudnessMeterProps> = memo(
    ({ className = '', targetLufs = LOUDNESS_TARGETS.streaming }) => {
        const { stats, settings, ready, latencySeconds, setSettings, resetLoudness } =
            useMasterLoudness();

        const onCeilingChange = useCallback(
            (event: React.ChangeEvent<HTMLInputElement>) => {
                setSettings({ ceilingDbtp: Number(event.target.value) });
            },
            [setSettings],
        );

        const overCeiling = stats.truePeak > settings.ceilingDbtp + 0.05;
        // Gain reduction is negative; 12 dB fills the bar.
        const grFraction = Math.min(1, Math.abs(stats.gainReduction) / 12);

        return (
            <section
                className={`flex flex-col gap-2 rounded-md border border-neutral-700 bg-neutral-900/80 p-2 ${className}`}
                aria-label="Master loudness"
            >
                <div className="flex items-center justify-between gap-3">
                    <span className="text-[9px] uppercase tracking-widest text-neutral-400">
                        Master LUFS
                    </span>
                    <button
                        type="button"
                        onClick={resetLoudness}
                        className="rounded border border-neutral-600 px-1.5 py-0.5 text-[9px] uppercase text-neutral-300 hover:bg-neutral-700"
                        title="Restart the gated integrated measurement and clear peak holds"
                    >
                        Reset
                    </button>
                </div>

                <div className="flex items-end justify-between gap-3">
                    <Readout label="M" value={stats.momentary} title="Momentary loudness (400 ms)" />
                    <Readout label="S" value={stats.shortTerm} title="Short-term loudness (3 s)" />
                    <Readout
                        label="I"
                        value={stats.integrated}
                        title="Gated integrated loudness since last reset"
                        highlight
                    />
                    <div
                        className="flex flex-col items-center gap-0.5"
                        title="Held true peak (inter-sample), dBTP"
                    >
                        <span className="text-[9px] uppercase tracking-wide text-neutral-400">
                            dBTP
                        </span>
                        <span
                            className={`${READOUT_CLASS} ${
                                overCeiling ? 'text-red-400' : 'text-neutral-100'
                            }`}
                        >
                            {formatLufs(stats.truePeak)}
                        </span>
                    </div>
                </div>

                {/* Momentary bar with the target marker. */}
                <div
                    className="relative h-2 w-full overflow-hidden rounded-sm bg-neutral-800"
                    role="meter"
                    aria-label="Momentary loudness"
                    aria-valuenow={Number.isFinite(stats.momentary) ? stats.momentary : -40}
                    aria-valuemin={-40}
                    aria-valuemax={0}
                >
                    <div
                        className="h-full bg-emerald-500"
                        style={{ width: `${loudnessToFraction(stats.momentary) * 100}%` }}
                    />
                    <div
                        className="absolute top-0 h-full w-px bg-amber-300"
                        style={{ left: `${loudnessToFraction(targetLufs) * 100}%` }}
                        title={`Target ${targetLufs} LUFS`}
                    />
                </div>

                {/* Gain reduction, drawn right-to-left like a hardware GR meter. */}
                <div className="flex items-center gap-2">
                    <span className="text-[9px] uppercase tracking-wide text-neutral-400">GR</span>
                    <div className="relative h-2 flex-1 overflow-hidden rounded-sm bg-neutral-800">
                        <div
                            className="absolute right-0 h-full bg-amber-500"
                            style={{ width: `${grFraction * 100}%` }}
                        />
                    </div>
                    <span className={`${READOUT_CLASS} w-10 text-right text-neutral-300`}>
                        {stats.gainReduction.toFixed(1)}
                    </span>
                    <span
                        className={`h-2 w-2 rounded-full ${
                            stats.clipped ? 'bg-red-500' : 'bg-neutral-700'
                        }`}
                        title={stats.clipped ? 'Limiter clipped' : 'No clipping'}
                        aria-label={stats.clipped ? 'Clip indicator lit' : 'Clip indicator off'}
                    />
                </div>

                <div className="flex items-center gap-2">
                    <label className="flex items-center gap-1 text-[9px] uppercase text-neutral-400">
                        <input
                            type="checkbox"
                            checked={settings.enabled}
                            onChange={(event) => setSettings({ enabled: event.target.checked })}
                            disabled={!ready}
                            aria-label="Limiter enabled"
                        />
                        Limiter
                    </label>
                    <label
                        className="flex items-center gap-1 text-[9px] uppercase text-neutral-400"
                        title="Zero-latency hard clip for live monitoring"
                    >
                        <input
                            type="checkbox"
                            checked={settings.monitorOnly}
                            onChange={(event) => setSettings({ monitorOnly: event.target.checked })}
                            disabled={!ready || !settings.enabled}
                            aria-label="Monitor-only mode"
                        />
                        Live
                    </label>
                    <label className="ml-auto flex items-center gap-1 text-[9px] uppercase text-neutral-400">
                        Ceiling
                        <input
                            type="range"
                            min={-12}
                            max={0}
                            step={0.1}
                            value={settings.ceilingDbtp}
                            onChange={onCeilingChange}
                            disabled={!ready}
                            className="w-20"
                            aria-label="Limiter ceiling in dBTP"
                        />
                        <span className={`${READOUT_CLASS} w-8 text-neutral-100`}>
                            {settings.ceilingDbtp.toFixed(1)}
                        </span>
                    </label>
                </div>

                <p className="text-[9px] text-neutral-500">
                    {ready
                        ? `Lookahead latency ${(latencySeconds * 1000).toFixed(1)} ms`
                        : 'Master meter offline'}
                </p>
            </section>
        );
    },
);

MasterLoudnessMeter.displayName = 'MasterLoudnessMeter';
