import React, { useState } from 'react';
import type { KnobConfig } from './HardwareModule';
import { type HarmonizerConfig } from '../engines/Harmonizer';
import { LadderButton } from './sampler/LadderButton';
import { VerticalKnob } from './sampler/VerticalKnob';
import { HSlider } from './sampler/HSlider';
import { HarmonizerPopover } from './sampler/HarmonizerPopover';

interface SamplerVoicePanelProps {
    title: string;
    colorHex: [number, number, number];
    controls: KnobConfig[];
    onParamChange: (id: string, value: number) => void;
    onRecordToggle?: (id: string) => void;
    is3D?: boolean;
    children?: React.ReactNode;
    // Sampler-specific props
    rootNote?: number; // 0-96 (C1-C8)
    coarseTune?: number; // -24 to +24
    fineTune?: number; // -50 to +50
    formantShift?: number; // -12 to +12
    pitchAttack?: number; // 0-1
    pitchDecay?: number; // 0-1
    quality?: 'preview' | 'good' | 'better' | 'best';
    stretchMode?: 'precise' | 'elastic' | 'hybrid';
    lockToSequencer?: boolean;
    onSamplerParamChange?: (param: string, value: number | string | boolean) => void;
    // Harmonizer props
    harmonizerConfig?: HarmonizerConfig;
    onHarmonizerConfigChange?: (config: HarmonizerConfig, isActive: boolean) => void;
    isHarmonizeActive?: boolean;
}

const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

const midiToNote = (midi: number) => {
    const noteIndex = midi % 12;
    const octave = Math.floor(midi / 12) - 1; // MIDI 0 = C-1, we want C1 = MIDI 24
    return `${NOTES[noteIndex]}${octave}`;
};


export const SamplerVoicePanel: React.FC<SamplerVoicePanelProps> = ({
    title,
    colorHex,
    controls,
    onParamChange,
    onRecordToggle,
    is3D = false,
    children,
    rootNote = 60, // C4 default
    coarseTune = 0,
    fineTune = 0,
    formantShift = 0,
    pitchAttack = 0,
    pitchDecay = 0.5,
    quality = 'good',
    stretchMode = 'elastic',
    lockToSequencer = false,
    onSamplerParamChange,
    harmonizerConfig,
    onHarmonizerConfigChange,
    isHarmonizeActive = false
}) => {
    const [localRootNote, setLocalRootNote] = useState(rootNote);
    const [localCoarse, setLocalCoarse] = useState(coarseTune);
    const [localFine, setLocalFine] = useState(fineTune);
    const [localFormant, setLocalFormant] = useState(formantShift);
    const [localPitchAtk, setLocalPitchAtk] = useState(pitchAttack);
    const [localPitchDec, setLocalPitchDecay] = useState(pitchDecay);
    const [localQuality, setLocalQuality] = useState<typeof quality>(quality);
    const [localStretch, setLocalStretch] = useState<typeof stretchMode>(stretchMode);
    const [localLock, setLocalLock] = useState(lockToSequencer);
    const [isHarmonizerOpen, setIsHarmonizerOpen] = useState(false);

    const handleRootNoteChange = (midi: number) => {
        setLocalRootNote(midi);
        onSamplerParamChange?.('rootNote', midi);
    };

    const handleParamChange = (param: string, value: number | string | boolean) => {
        switch (param) {
            case 'coarseTune': setLocalCoarse(value as number); break;
            case 'fineTune': setLocalFine(value as number); break;
            case 'formantShift': setLocalFormant(value as number); break;
            case 'pitchAttack': setLocalPitchAtk(value as number); break;
            case 'pitchDecay': setLocalPitchDecay(value as number); break;
            case 'quality': setLocalQuality(value as typeof quality); break;
            case 'stretchMode': setLocalStretch(value as typeof stretchMode); break;
            case 'lockToSequencer': setLocalLock(value as boolean); break;
        }
        onSamplerParamChange?.(param, value);
    };

    // Generate root note ladder (C1 = 24 to C8 = 108, showing range around current)
    const ladderNotes = React.useMemo(() => {
        const center = localRootNote;
        const start = Math.max(24, center - 6);
        const end = Math.min(108, center + 6);
        const notes = [];
        for (let i = start; i <= end; i++) {
            notes.push({ midi: i, note: midiToNote(i) });
        }
        return notes;
    }, [localRootNote]);

    const color = `rgba(${colorHex[0] * 255}, ${colorHex[1] * 255}, ${colorHex[2] * 255}, 1)`;

    // Default harmonizer config
    const defaultConfig: HarmonizerConfig = {
        voiceCount: 2,
        harmonyType: 'third',
        detuneSpread: 15,
        formantSpread: 3
    };

    return (
        <div className="relative w-full h-full flex flex-col">
            {/* Main WebGPU Knobs Area (ADSR, etc.) */}
            <div className="flex-1 relative">
                <HardwareModule
                    title={title}
                    colorHex={colorHex}
                    controls={controls}
                    onParamChange={onParamChange}
                    onRecordToggle={onRecordToggle}
                    is3D={is3D}
                >
                    {children}
                </HardwareModule>
            </div>

            {/* Sampler Voice Controls Panel */}
            <div className="h-[180px] bg-gradient-to-b from-zinc-900 via-zinc-950 to-black border-t-2 border-purple-500/30 p-3 flex gap-4 shrink-0 relative overflow-hidden">
                {/* Subtle grid pattern */}
                <div className="absolute inset-0 opacity-5" style={{
                    backgroundImage: `linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)`,
                    backgroundSize: '20px 20px'
                }} />
                {/* Left: Root Note Ladder */}
                <div className="flex flex-col items-center gap-2 w-12 relative z-10">
                    <span className="text-[9px] font-mono text-purple-400 font-bold tracking-wider px-2 py-0.5 rounded bg-purple-500/10 border border-purple-500/20">ROOT</span>
                    <div className="flex flex-col gap-0.5 p-1.5 rounded-lg bg-zinc-950/50 border border-zinc-800/50">
                        {ladderNotes.map(({ midi, note }) => (
                            <LadderButton
                                key={midi}
                                note={note}
                                isActive={midi === localRootNote}
                                onClick={() => handleRootNoteChange(midi)}
                            />
                        ))}
                    </div>
                </div>

                {/* Middle: Tune Controls */}
                <div className="flex flex-col gap-3 w-40 relative z-10">
                    {/* Section header */}
                    <div className="flex items-center gap-2">
                        <span className="text-[9px] font-mono text-cyan-400 font-bold tracking-wider px-2 py-0.5 rounded bg-cyan-500/10 border border-cyan-500/20">TUNE</span>
                        <div className="flex-1 h-px bg-gradient-to-r from-cyan-500/30 to-transparent" />
                    </div>
                    <HSlider
                        label="COARSE"
                        value={localCoarse / 24}
                        displayValue={`${localCoarse > 0 ? '+' : ''}${localCoarse}st`}
                        onChange={(v) => handleParamChange('coarseTune', Math.round(v * 24))}
                        colorHex={colorHex}
                    />
                    <HSlider
                        label="FINE"
                        value={localFine / 50}
                        displayValue={`${localFine > 0 ? '+' : ''}${localFine}¢`}
                        onChange={(v) => handleParamChange('fineTune', Math.round(v * 50))}
                        colorHex={colorHex}
                    />
                    <HSlider
                        label="FORMANT"
                        value={localFormant / 12}
                        displayValue={`${localFormant > 0 ? '+' : ''}${localFormant}st`}
                        onChange={(v) => handleParamChange('formantShift', Math.round(v * 12))}
                        colorHex={colorHex}
                    />
                </div>

                {/* Right: Pitch Envelope, RubberBand & Harmonizer */}
                <div className="flex flex-col gap-2 flex-1 relative z-10">
                    {/* Pitch Envelope */}
                    <div className="flex items-center gap-3">
                        <span className="text-[9px] font-mono text-purple-400 font-bold tracking-wider px-2 py-0.5 rounded bg-purple-500/10 border border-purple-500/20">PITCH ENV</span>
                        <VerticalKnob
                            label="ATK"
                            value={localPitchAtk}
                            onChange={(v) => handleParamChange('pitchAttack', v)}
                            colorHex={colorHex}
                        />
                        <VerticalKnob
                            label="DEC"
                            value={localPitchDec}
                            onChange={(v) => handleParamChange('pitchDecay', v)}
                            colorHex={colorHex}
                        />
                    </div>

                    {/* Divider */}
                    <div className="h-px bg-gradient-to-r from-transparent via-purple-500/30 to-transparent my-1" />

                    {/* RubberBand Section */}
                    <div className="flex flex-col gap-2">
                        <div className="flex items-center gap-2">
                            <span className="text-[9px] font-mono text-cyan-400 font-bold tracking-wider px-2 py-0.5 rounded bg-cyan-500/10 border border-cyan-500/20">RUBBERBAND</span>
                            <div className="flex-1 h-px bg-gradient-to-r from-cyan-500/30 to-transparent" />
                        </div>
                        
                        <div className="flex gap-2">
                            <div className="flex-1 relative">
                                <select
                                    value={localQuality}
                                    onChange={(e) => handleParamChange('quality', e.target.value)}
                                    className="w-full bg-zinc-950 text-[10px] text-gray-300 border border-zinc-700 rounded-md px-2 py-1.5 outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/30 appearance-none cursor-pointer shadow-[inset_0_1px_2px_rgba(0,0,0,0.5)]"
                                >
                                    <option value="preview">Preview</option>
                                    <option value="good">Good</option>
                                    <option value="better">Better</option>
                                    <option value="best">Best</option>
                                </select>
                                <div className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-cyan-500 text-[8px]">▼</div>
                            </div>

                            <div className="flex-1 relative">
                                <select
                                    value={localStretch}
                                    onChange={(e) => handleParamChange('stretchMode', e.target.value)}
                                    className="w-full bg-zinc-950 text-[10px] text-gray-300 border border-zinc-700 rounded-md px-2 py-1.5 outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/30 appearance-none cursor-pointer shadow-[inset_0_1px_2px_rgba(0,0,0,0.5)]"
                                >
                                    <option value="precise">Precise</option>
                                    <option value="elastic">Elastic</option>
                                    <option value="hybrid">Hybrid</option>
                                </select>
                                <div className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-cyan-500 text-[8px]">▼</div>
                            </div>
                        </div>

                        <label className="flex items-center gap-2 cursor-pointer mt-1 group">
                            <div className={`w-9 h-5 rounded-full border transition-all relative overflow-hidden shadow-[inset_0_2px_4px_rgba(0,0,0,0.5)] ${localLock ? 'bg-cyan-600/80 border-cyan-400' : 'bg-zinc-800 border-zinc-600'}`}>
                                <div className={`w-4 h-4 rounded-full bg-gradient-to-b from-zinc-200 to-zinc-400 transition-all absolute top-0.5 shadow-md ${localLock ? 'translate-x-4' : 'translate-x-0.5'}`}>
                                    <div className="absolute top-0.5 left-0.5 right-0.5 h-px bg-white/50 rounded-full" />
                                </div>
                                {/* LED indicator */}
                                {localLock && (
                                    <span className="absolute left-1 top-1/2 -translate-y-1/2 w-1 h-1 rounded-full bg-cyan-300 shadow-[0_0_6px_rgba(34,211,238,0.8)]" />
                                )}
                            </div>
                            <input
                                type="checkbox"
                                checked={localLock}
                                onChange={(e) => handleParamChange('lockToSequencer', e.target.checked)}
                                className="sr-only"
                            />
                            <span className={`text-[10px] font-mono transition-colors ${localLock ? 'text-cyan-400' : 'text-gray-400 group-hover:text-gray-300'}`}>LOCK TO SEQUENCER NOTES</span>
                        </label>
                    </div>

                    {/* Divider */}
                    <div className="h-px bg-gradient-to-r from-transparent via-purple-500/30 to-transparent my-1" />

                    {/* Harmonizer Section */}
                    <div className="relative">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <span className="text-[9px] font-mono font-bold tracking-wider px-2 py-0.5 rounded border" style={{ color, borderColor: `${color}40`, background: `${color}10` }}>
                                    HARMONIZER
                                </span>
                                {isHarmonizeActive && (
                                    <span className="flex items-center gap-1">
                                        <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: color, boxShadow: `0 0 8px ${color}` }} />
                                        <span className="text-[8px] font-mono text-gray-500">
                                            {(harmonizerConfig?.voiceCount || 2)}V · {(harmonizerConfig?.harmonyType || 'third').toUpperCase()}
                                        </span>
                                    </span>
                                )}
                            </div>
                            
                            {/* HARMONIZE Button - Hardware style */}
                            <div className="relative">
                                <button
                                    onClick={() => setIsHarmonizerOpen(!isHarmonizerOpen)}
                                    aria-haspopup="dialog"
                                    aria-expanded={isHarmonizerOpen}
                                    aria-label="Harmonizer Settings"
                                    className={`px-4 py-1.5 rounded-lg text-[10px] font-bold font-orbitron tracking-wider transition-all border relative overflow-hidden ${
                                        isHarmonizeActive
                                            ? 'text-black'
                                            : 'bg-gradient-to-b from-zinc-800 to-zinc-900 text-zinc-400 border-zinc-700 hover:text-zinc-300 hover:border-zinc-600'
                                    }`}
                                    style={isHarmonizeActive ? {
                                        background: `linear-gradient(135deg, ${color} 0%, ${color}dd 100%)`,
                                        borderColor: color,
                                        boxShadow: `0 0 20px ${color}60, inset 0 1px 0 rgba(255,255,255,0.2)`
                                    } : {
                                        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05), 0 4px 8px rgba(0,0,0,0.3)'
                                    }}
                                >
                                    {/* Shine effect */}
                                    <span className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full hover:translate-x-full transition-transform duration-500" />
                                    <span className="relative flex items-center gap-1.5">
                                        {isHarmonizeActive && <span className="w-1.5 h-1.5 rounded-full bg-black/30" />}
                                        {isHarmonizeActive ? 'HARMONIZE' : 'HARMONIZE'}
                                    </span>
                                </button>

                                {/* Harmonizer Popover */}
                                <HarmonizerPopover
                                    isOpen={isHarmonizerOpen}
                                    onClose={() => setIsHarmonizerOpen(false)}
                                    config={harmonizerConfig || defaultConfig}
                                    isActive={isHarmonizeActive}
                                    onApply={onHarmonizerConfigChange || (() => {})}
                                    colorHex={colorHex}
                                />
                            </div>
                        </div>

                    </div>
                </div>
            </div>
        </div>
    );
};
