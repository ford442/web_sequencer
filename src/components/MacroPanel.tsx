import React, { memo } from 'react';
import { HelpIconButton } from './help/HelpTip';
import type { MacroSynthParams, Waveform } from '../types';
import {
    MACRO_BANKS,
    MACRO_MAX_POLYPHONY,
    macroEngineForWaveform,
    resolveMacroParams,
} from '../engines/MacroParams';
import { MACRO_PRESETS, getMacroPreset, type MacroPreset } from '../engines/macroPresets';

interface MacroPanelProps {
    waveform: Waveform;
    macro?: MacroSynthParams;
    /** Accent colour matching the rack module */
    accentColor?: 'pink' | 'cyan';
    onMacroChange: (patch: Partial<MacroSynthParams>) => void;
    onPresetChange: (preset: MacroPreset) => void;
}

const VOICE_CHOICES = [1, 2, 4, MACRO_MAX_POLYPHONY] as const;

/**
 * The macro engine's switches and patches, shown on SYNTH A / SYNTH B while a
 * `macro-*` model is selected. The model grid lives in the variant selector
 * and the knobs (HARMONICS / TIMBRE / MORPH / DECAY / COLOUR …) on the rack
 * module itself, where they are MIDI-learnable and automatable.
 */
export const MacroPanel: React.FC<MacroPanelProps> = memo(({
    waveform,
    macro,
    accentColor = 'cyan',
    onMacroChange,
    onPresetChange,
}) => {
    const engine = macroEngineForWaveform(waveform);
    if (!engine) return null;
    const m = resolveMacroParams(macro);

    const activeStyle = 'bg-gradient-to-b from-cyan-500 to-cyan-600 text-white border-cyan-400 shadow-[0_0_8px_rgba(6,182,212,0.45)]';
    const inactiveStyle = 'bg-gradient-to-b from-zinc-800 to-zinc-900 text-zinc-400 border-zinc-700 hover:text-zinc-200';
    const borderColorStyle = accentColor === 'cyan' ? 'border-cyan-500/20' : 'border-pink-500/20';
    const labelColorStyle = accentColor === 'cyan' ? 'text-cyan-400/70' : 'text-pink-400/70';
    const sliderAccent = accentColor === 'cyan' ? 'accent-cyan-400' : 'accent-pink-400';
    const selectId = `macro-preset-${accentColor}`;

    return (
        <div
            className={`flex w-56 flex-col gap-1.5 p-2 rounded-lg bg-zinc-950/80 border ${borderColorStyle}`}
            role="group"
            aria-label="Macro engine parameters"
        >
            <div className="flex items-center justify-between gap-1">
                <span className={`text-[8px] font-mono uppercase tracking-wider ${labelColorStyle}`}>
                    {engine.label}
                </span>
                <HelpIconButton topicId="macro-engine" />
            </div>

            {/* ── Patch ─────────────────────────────────────────────────── */}
            <label htmlFor={selectId} className={`text-[7px] font-mono uppercase tracking-wider ${labelColorStyle}`}>
                Patch
            </label>
            <select
                id={selectId}
                value=""
                onChange={(e) => {
                    const preset = getMacroPreset(e.target.value);
                    if (preset) onPresetChange(preset);
                }}
                className="bg-zinc-900 text-[9px] text-zinc-200 border border-zinc-700 rounded px-1 py-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500"
            >
                <option value="" disabled>Load a patch…</option>
                {MACRO_BANKS.map(({ bank, label }) => (
                    <optgroup key={bank} label={label}>
                        {MACRO_PRESETS.filter((preset) => preset.bank === bank).map((preset) => (
                            <option key={preset.id} value={preset.id}>{preset.name}</option>
                        ))}
                    </optgroup>
                ))}
            </select>

            {/* ── LPG mode ──────────────────────────────────────────────── */}
            <span className={`text-[7px] font-mono uppercase tracking-wider ${labelColorStyle}`}>
                Envelope{engine.selfEnveloped ? ' (model has its own)' : ''}
            </span>
            <div className="flex gap-1" role="group" aria-label="Low-pass gate mode">
                {(['gate', 'ping'] as const).map((mode) => (
                    <button type="button"
                        key={mode}
                        onClick={() => onMacroChange({ lpgMode: mode })}
                        aria-pressed={m.lpgMode === mode}
                        title={mode === 'gate'
                            ? 'Gate: the low-pass gate stays open for the note length, DECAY is the release'
                            : 'Ping: every note strikes the low-pass gate, DECAY sets the whole envelope'}
                        className={`flex-1 py-0.5 text-[8px] font-bold uppercase rounded border transition-all ${m.lpgMode === mode ? activeStyle : inactiveStyle}`}
                    >
                        {mode}
                    </button>
                ))}
            </div>

            {/* ── Voices ────────────────────────────────────────────────── */}
            <span className={`text-[7px] font-mono uppercase tracking-wider ${labelColorStyle}`}>
                Voices
            </span>
            <div className="flex gap-1" role="group" aria-label="Polyphony">
                {VOICE_CHOICES.map((n) => (
                    <button type="button"
                        key={n}
                        onClick={() => onMacroChange({ polyphony: n })}
                        aria-pressed={m.polyphony === n}
                        aria-label={n === 1 ? 'Mono (legato slides)' : `${n} voices`}
                        title={n === 1 ? 'Mono: slid notes glide legato' : `${n}-voice polyphony`}
                        className={`flex-1 py-0.5 text-[8px] font-bold rounded border transition-all ${m.polyphony === n ? activeStyle : inactiveStyle}`}
                    >
                        {n === 1 ? 'MONO' : n}
                    </button>
                ))}
            </div>

            {/* ── AUX ───────────────────────────────────────────────────── */}
            <span className={`text-[7px] font-mono uppercase tracking-wider ${labelColorStyle}`} title={`AUX output: ${engine.aux}`}>
                Out → Aux ({engine.aux})
            </span>
            <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={m.auxMix}
                onChange={(e) => onMacroChange({ auxMix: parseFloat(e.target.value) })}
                title={`Aux mix: ${Math.round(m.auxMix * 100)}%`}
                aria-label="Aux mix"
                className={`w-full h-1.5 rounded-full appearance-none cursor-pointer bg-zinc-700 ${sliderAccent}`}
            />
        </div>
    );
});

MacroPanel.displayName = 'MacroPanel';
