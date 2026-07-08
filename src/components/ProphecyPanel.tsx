import React, { memo } from 'react';
import { HelpIconButton } from './help/HelpTip';

/** Vowel labels in order matching ProphecyParam.VOWEL (0=A, 1=E, 2=I, 3=O, 4=U) */
const VOWEL_LABELS = ['A', 'E', 'I', 'O', 'U'] as const;

interface ProphecyPanelProps {
    /** Current vowel formant 0–4 */
    vowel?: number;
    /** Current portamento rate 0–1 */
    portamento?: number;
    /** Current formant shift 0–1 */
    formantShift?: number;
    /** Accent colour matching the rack module */
    accentColor?: 'pink' | 'cyan';
    onVowelChange: (v: number) => void;
    onPortamentoChange: (v: number) => void;
    onFormantShiftChange: (v: number) => void;
}

/**
 * Overlay panel for Korg Prophecy-specific voice parameters.
 *
 * Renders:
 *  - Vowel A/E/I/O/U select buttons
 *  - Formant Shift slider (0–1)
 *  - Portamento slider (0–1)
 *
 * Shown inside synthAChild / synthBChild when a 'prophecy-*' waveform is active.
 */
export const ProphecyPanel: React.FC<ProphecyPanelProps> = memo(({
    vowel = 0,
    portamento = 0,
    formantShift = 0,
    accentColor = 'cyan',
    onVowelChange,
    onPortamentoChange,
    onFormantShiftChange,
}) => {
    const isActive = (v: number) => Math.round(vowel) === v;

    // Use Prophecy family violet for the vowel buttons (themed per oscillator type).
    // The outer panel tint + part accent (cyan/pink labels) provide the voice + family mix.
    const activeStyle = 'bg-gradient-to-b from-violet-500 to-violet-600 text-white border-violet-400 shadow-[0_0_10px_rgba(139,92,246,0.45),inset_0_1px_0_rgba(255,255,255,0.2)]';
    const inactiveStyle = 'bg-gradient-to-b from-zinc-800 to-zinc-900 text-zinc-400 border-zinc-700 hover:text-zinc-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]';

    const borderColorStyle = accentColor === 'cyan' ? 'border-cyan-500/20' : 'border-pink-500/20';
    const labelColorStyle  = accentColor === 'cyan' ? 'text-cyan-400/70'   : 'text-pink-400/70';
    const sliderAccent     = accentColor === 'cyan' ? 'accent-cyan-400'     : 'accent-pink-400';

    return (
        <div
            className={`flex flex-col gap-2 p-2 rounded-lg bg-zinc-950/80 border ${borderColorStyle}`}
            role="group"
            aria-label="Prophecy parameters"
        >
            {/* ── Vowel ─────────────────────────────────────────────── */}
            <div className="flex items-center justify-between gap-1">
                <span className={`text-[8px] font-mono uppercase tracking-wider ${labelColorStyle}`}>
                    Vowel
                </span>
                <HelpIconButton topicId="prophecy-formants" />
            </div>
            <div className="flex gap-1">
                {VOWEL_LABELS.map((label, idx) => (
                    <button
                        key={label}
                        onClick={() => onVowelChange(idx)}
                        aria-pressed={isActive(idx)}
                        aria-label={`Vowel ${label}`}
                        title={`Vowel ${label} (formant preset ${idx})`}
                        className={`flex-1 py-1 text-[9px] font-bold rounded-md transition-all border ${
                            isActive(idx) ? activeStyle : inactiveStyle
                        }`}
                    >
                        {label}
                    </button>
                ))}
            </div>

            {/* ── Formant Shift ──────────────────────────────────────── */}
            <span className={`text-[8px] font-mono uppercase tracking-wider ${labelColorStyle}`}>
                Formant Shift
            </span>
            <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={formantShift}
                onChange={(e) => onFormantShiftChange(parseFloat(e.target.value))}
                title={`Formant Shift: ${(formantShift * 100).toFixed(0)}%`}
                aria-label="Formant Shift"
                className={`w-full h-1.5 rounded-full appearance-none cursor-pointer bg-zinc-700 ${sliderAccent}`}
            />

            {/* ── Portamento ─────────────────────────────────────────── */}
            <span className={`text-[8px] font-mono uppercase tracking-wider ${labelColorStyle}`}>
                Portamento
            </span>
            <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={portamento}
                onChange={(e) => onPortamentoChange(parseFloat(e.target.value))}
                title={`Portamento: ${(portamento * 100).toFixed(0)}%`}
                aria-label="Portamento"
                className={`w-full h-1.5 rounded-full appearance-none cursor-pointer bg-zinc-700 ${sliderAccent}`}
            />
        </div>
    );
});

ProphecyPanel.displayName = 'ProphecyPanel';
