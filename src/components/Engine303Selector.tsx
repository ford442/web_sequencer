import React, { memo } from 'react';
import type { Engine303 } from '../types';

interface Engine303SelectorProps {
    /** Currently active engine for this voice. */
    engine: Engine303;
    /** Called when the user selects a different engine. */
    onChange: (engine: Engine303) => void;
    /** Accent colour matching the rack module (default: 'pink'). */
    accentColor?: 'pink' | 'cyan';
}

/**
 * Engine selector toggle for TB-303 voices (SYNTH A, SYNTH B and BASS 2).
 *
 * Lets the user switch between:
 *  - **Custom Open303** – built-in open303_* WASM synthesizer
 *  - **Authentic JC303** – rosic::Open303 from the jc303_wasm submodule
 *    (per-voice engine selection landed in the May 25, 2026 commit;
 *     see `emscripten/jc303_wrapper.cpp` and `src/engines/Open303Oscillator.ts`)
 */
export const Engine303Selector: React.FC<Engine303SelectorProps> = memo(({
    engine,
    onChange,
    accentColor = 'pink',
}) => {
    const isJc303 = engine === 'jc303';

    // Themed by 303 engine family (open303 = emerald, jc303 = teal) for osc-type visual treatment.
    // Part accent (cyan/pink) still used for header badge/labels.
    const openActive = 'bg-gradient-to-b from-emerald-500 to-emerald-600 text-white border-emerald-400 shadow-[0_0_12px_rgba(16,185,129,0.5),inset_0_1px_0_rgba(255,255,255,0.2)]';
    const jcActive = 'bg-gradient-to-b from-teal-500 to-teal-600 text-white border-teal-400 shadow-[0_0_12px_rgba(20,184,166,0.5),inset_0_1px_0_rgba(255,255,255,0.2)]';
    const inactiveStyle = 'bg-gradient-to-b from-zinc-800 to-zinc-900 text-zinc-400 border-zinc-700 hover:text-zinc-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]';

    const badgeColorStyle = accentColor === 'cyan'
        ? 'bg-cyan-950/90 text-cyan-300 border-cyan-500/60'
        : 'bg-pink-950/90 text-pink-300 border-pink-500/60';

    const labelColorStyle = accentColor === 'cyan'
        ? 'text-cyan-400/70'
        : 'text-pink-400/70';

    const borderColorStyle = accentColor === 'cyan'
        ? 'border-cyan-500/20'
        : 'border-pink-500/20';

    return (
        <div
            className={`flex flex-col gap-1 p-2 rounded-lg bg-zinc-950/80 border ${borderColorStyle}`}
            role="group"
            aria-label="303 engine selection"
        >
            {/* Row: "Engine" label + JC303-active badge */}
            <div className="flex items-center justify-between gap-1">
                <span className={`text-[8px] font-mono uppercase tracking-wider ${labelColorStyle}`}>
                    Engine
                </span>
                {isJc303 && (
                    <span
                        className={`text-[7px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded-full border animate-pulse ${badgeColorStyle}`}
                        title="Authentic rosic::Open303 engine (jc303_wasm submodule) is active for this voice"
                        aria-label="JC303 engine active"
                    >
                        JC303 ✓
                    </span>
                )}
            </div>

            {/* Custom Open303 button */}
            <button
                onClick={() => onChange('open303')}
                title="Custom Open303 synthesizer — uses the built-in open303_* WASM API in hyphon_native.wasm"
                aria-pressed={!isJc303}
                aria-label="Select Custom Open303 engine"
                className={`px-3 py-1.5 text-[9px] font-bold rounded-md transition-all border focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:ring-offset-2 ${
                    !isJc303 ? openActive : inactiveStyle
                }`}
            >
                Custom Open303
            </button>

            {/* Authentic JC303 button */}
            <button
                onClick={() => onChange('jc303')}
                title="Authentic rosic::Open303 — per-voice JC303 engine from the jc303_wasm submodule (rosic_Open303). Enables the accurate TB-303 DSP introduced in the May 2026 per-voice engine update."
                aria-pressed={isJc303}
                aria-label="Select Authentic JC303 engine"
                className={`px-3 py-1.5 text-[9px] font-bold rounded-md transition-all border focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:ring-offset-2 ${
                    isJc303 ? jcActive : inactiveStyle
                }`}
            >
                Authentic JC303
            </button>
        </div>
    );
});
