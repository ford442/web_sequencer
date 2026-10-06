import { memo, useCallback } from 'react'
import { transportMixStore, useTransportMixStore } from '../../stores/transportMixStore'
import { MAX_SWING, METER_PRESETS, STRAIGHT_SWING } from '../../utils/songMeter'
import { nudgePatternLength } from '../../utils/meterActions'
import type { TimeSignature } from '../../utils/musicTheory'

/**
 * Hardware-style LEN / METER / SWING cluster for the transport bar.
 *
 * Reads and writes the song-wide meter in `transportMixStore` directly, so no
 * props thread through TransportHeader. Styling mirrors the BPM block.
 */

const SWING_STEP = 2

const insetClass =
    'flex items-center bg-zinc-950 rounded-md border border-zinc-800 shadow-[inset_0_1px_2px_rgba(0,0,0,0.5)]'
const stepButtonClass =
    'w-5 h-7 text-cyan-500 hover:text-cyan-400 font-bold text-sm transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0d1014] hover:bg-zinc-900/50 active:scale-95 disabled:opacity-40 disabled:pointer-events-none'
const labelClass = 'text-[9px] text-gray-500 font-mono uppercase tracking-wider'

const meterLabel = (ts: TimeSignature) => `${ts[0]}/${ts[1]}`

export const MeterControls = memo(function MeterControls() {
    const stepCount = useTransportMixStore((s) => s.stepCount)
    const timeSignature = useTransportMixStore((s) => s.timeSignature)
    const swing = useTransportMixStore((s) => s.swing)

    const onMeterChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
        const preset = METER_PRESETS.find((ts) => meterLabel(ts) === e.target.value)
        if (preset) transportMixStore.setTimeSignature([preset[0], preset[1]])
    }, [])

    const nudgeSwing = useCallback((direction: 1 | -1) => {
        transportMixStore.setSwing((prev) => {
            const next = Math.round(prev) + direction * SWING_STEP
            return Math.max(STRAIGHT_SWING, Math.min(MAX_SWING, next))
        })
    }, [])

    const currentMeter = meterLabel(timeSignature)
    const meterIsPreset = METER_PRESETS.some((ts) => meterLabel(ts) === currentMeter)
    const swingDisplay = Math.round(swing)

    return (
        <div className="flex items-center gap-2" data-testid="meter-controls">
            {/* Pattern length */}
            <div className="flex items-center gap-1.5" role="group" aria-label="Pattern length">
                <span className={labelClass} aria-hidden="true">LEN</span>
                <div className={insetClass}>
                    <button type="button"
                        onClick={() => nudgePatternLength(-1)}
                        className={`${stepButtonClass} border-r border-zinc-800 rounded-l-md`}
                        title="Shorter pattern (Shift + [)"
                        aria-label="Shorten pattern"
                    >
                        <span aria-hidden="true">−</span>
                    </button>
                    <span
                        className="w-7 text-center font-mono text-cyan-300 text-sm font-semibold"
                        data-testid="pattern-length-value"
                        aria-label={`Pattern length: ${stepCount} steps`}
                    >
                        {stepCount}
                    </span>
                    <button type="button"
                        onClick={() => nudgePatternLength(1)}
                        className={`${stepButtonClass} border-l border-zinc-800 rounded-r-md`}
                        title="Longer pattern (Shift + ])"
                        aria-label="Lengthen pattern"
                    >
                        <span aria-hidden="true">+</span>
                    </button>
                </div>
            </div>

            {/* Time signature */}
            <label className="flex items-center gap-1.5">
                <span className={labelClass}>MTR</span>
                <select
                    value={currentMeter}
                    onChange={onMeterChange}
                    aria-label="Time signature"
                    title="Time signature — sets bar lines and launch quantize"
                    className="h-7 px-1 bg-zinc-950 border border-zinc-800 rounded-md font-mono text-cyan-300 text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500"
                >
                    {!meterIsPreset && <option value={currentMeter}>{currentMeter}</option>}
                    {METER_PRESETS.map((ts) => (
                        <option key={meterLabel(ts)} value={meterLabel(ts)}>{meterLabel(ts)}</option>
                    ))}
                </select>
            </label>

            {/* Swing */}
            <div className="flex items-center gap-1.5" role="group" aria-label="Swing">
                <span className={labelClass} aria-hidden="true">SWG</span>
                <div className={insetClass}>
                    <button type="button"
                        onClick={() => nudgeSwing(-1)}
                        disabled={swingDisplay <= STRAIGHT_SWING}
                        className={`${stepButtonClass} border-r border-zinc-800 rounded-l-md`}
                        title="Less swing"
                        aria-label="Decrease swing"
                    >
                        <span aria-hidden="true">−</span>
                    </button>
                    <span
                        className="w-9 text-center font-mono text-cyan-300 text-xs font-semibold"
                        data-testid="swing-value"
                        aria-label={swingDisplay <= STRAIGHT_SWING ? 'Swing: straight' : `Swing: ${swingDisplay} percent`}
                    >
                        {swingDisplay}%
                    </span>
                    <button type="button"
                        onClick={() => nudgeSwing(1)}
                        disabled={swingDisplay >= MAX_SWING}
                        className={`${stepButtonClass} border-l border-zinc-800 rounded-r-md`}
                        title="More swing (66% ≈ triplet)"
                        aria-label="Increase swing"
                    >
                        <span aria-hidden="true">+</span>
                    </button>
                </div>
            </div>
        </div>
    )
})
