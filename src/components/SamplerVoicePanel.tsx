import React, { useState, useCallback } from 'react';
import { HardwareModule, type KnobConfig } from './HardwareModule';
import { Harmonizer, type HarmonizerConfig, type HarmonyType, HARMONIZE_PRESETS } from '../engines/Harmonizer';

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

// Mini Ladder Button Component
const LadderButton: React.FC<{
    note: string;
    isActive: boolean;
    onClick: () => void;
}> = ({ note, isActive, onClick }) => (
    <button
        onClick={onClick}
        className={`w-8 h-5 text-[9px] font-mono font-bold rounded transition-all relative overflow-hidden ${
            isActive
                ? 'bg-cyan-500 text-black shadow-[0_0_8px_rgba(6,182,212,0.6)]'
                : 'bg-zinc-800 text-zinc-500 border border-zinc-700 hover:bg-zinc-700 hover:text-zinc-400 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]'
        }`}
    >
        {/* LED indicator for active state */}
        {isActive && (
            <span className="absolute left-0.5 top-1/2 -translate-y-1/2 w-1 h-1 rounded-full bg-white shadow-[0_0_4px_rgba(255,255,255,0.8)]" />
        )}
        <span className={isActive ? 'pl-1.5' : ''}>{note}</span>
    </button>
);

// Vertical Knob Component (for pitch envelope)
const VerticalKnob: React.FC<{
    label: string;
    value: number; // 0-1
    onChange: (value: number) => void;
    colorHex: [number, number, number];
}> = ({ label, value, onChange, colorHex }) => {
    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        const startY = e.clientY;
        const startVal = value;

        const handleMouseMove = (e: MouseEvent) => {
            const dy = startY - e.clientY;
            const newVal = Math.max(0, Math.min(1, startVal + dy * 0.01));
            onChange(newVal);
        };

        const handleMouseUp = () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
            document.body.style.cursor = 'default';
        };

        document.body.style.cursor = 'ns-resize';
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
    }, [value, onChange]);

    const color = `rgba(${colorHex[0] * 255}, ${colorHex[1] * 255}, ${colorHex[2] * 255}, 1)`;
    const height = 40;
    const fillHeight = value * height;

    return (
        <div className="flex flex-col items-center gap-1">
            <span className="text-[9px] font-mono text-gray-400 uppercase tracking-wider">{label}</span>
            <div
                className="w-6 rounded-full bg-zinc-900 border-2 border-zinc-600 cursor-ns-resize relative overflow-hidden shadow-[inset_0_2px_4px_rgba(0,0,0,0.5),inset_0_-1px_0_rgba(255,255,255,0.05)]"
                style={{ height: `${height}px` }}
                onMouseDown={handleMouseDown}
            >
                {/* Bevel highlight */}
                <div className="absolute inset-0 rounded-full border border-white/5 pointer-events-none" />
                {/* Fill with gradient */}
                <div
                    className="absolute bottom-0 left-0 right-0 rounded-b-full transition-all"
                    style={{
                        height: `${fillHeight}px`,
                        background: `linear-gradient(to top, ${color}, ${color}60 50%, ${color}30)`,
                        boxShadow: `0 0 15px ${color}50, inset 0 -2px 4px rgba(0,0,0,0.3)`
                    }}
                />
                {/* Center marker with LED style */}
                <div className="absolute left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/40 to-transparent top-1/2" />
                {/* Tick marks */}
                {[0.25, 0.5, 0.75].map(tick => (
                    <div 
                        key={tick}
                        className="absolute left-1 right-1 h-px bg-zinc-700"
                        style={{ bottom: `${tick * 100}%` }}
                    />
                ))}
            </div>
            <span className="text-[8px] font-mono text-cyan-400/60">{Math.round(value * 100)}%</span>
        </div>
    );
};

// Horizontal Slider Component
const HSlider: React.FC<{
    label: string;
    value: number; // -1 to 1 normalized
    displayValue: string;
    onChange: (value: number) => void;
    colorHex: [number, number, number];
}> = ({ label, value, displayValue, onChange, colorHex }) => {
    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        const rect = (e.target as HTMLElement).parentElement?.getBoundingClientRect();
        if (!rect) return;

        const handleMouseMove = (e: MouseEvent) => {
            const x = e.clientX - rect.left;
            const normalized = Math.max(-1, Math.min(1, (x / rect.width) * 2 - 1));
            onChange(normalized);
        };

        const handleMouseUp = () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
            document.body.style.cursor = 'default';
        };

        document.body.style.cursor = 'ew-resize';
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);

        // Initial set
        const x = e.clientX - rect.left;
        const normalized = Math.max(-1, Math.min(1, (x / rect.width) * 2 - 1));
        onChange(normalized);
    }, [onChange]);

    const color = `rgba(${colorHex[0] * 255}, ${colorHex[1] * 255}, ${colorHex[2] * 255}, 1)`;
    const percent = ((value + 1) / 2) * 100;

    return (
        <div className="flex flex-col gap-1.5 w-full">
            <div className="flex justify-between items-center">
                <span className="text-[9px] font-mono text-gray-400 uppercase tracking-wider">{label}</span>
                <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded bg-zinc-950/50 border border-zinc-800" style={{ color, textShadow: `0 0 8px ${color}60` }}>{displayValue}</span>
            </div>
            <div
                className="h-5 bg-zinc-900 rounded-md border border-zinc-700 cursor-ew-resize relative overflow-hidden shadow-[inset_0_2px_4px_rgba(0,0,0,0.5),inset_0_-1px_0_rgba(255,255,255,0.03)]"
                onMouseDown={handleMouseDown}
            >
                {/* Track background with gradient */}
                <div className="absolute inset-0 bg-gradient-to-b from-zinc-800/30 to-transparent" />
                {/* Center line with LED glow */}
                <div className="absolute left-1/2 top-0.5 bottom-0.5 w-px bg-gradient-to-b from-transparent via-white/30 to-transparent z-10" />
                {/* Fill from center with glow */}
                <div
                    className="absolute top-0.5 bottom-0.5 rounded-sm transition-all"
                    style={{
                        left: value < 0 ? `${percent}%` : '50%',
                        right: value > 0 ? `${100 - percent}%` : '50%',
                        background: `linear-gradient(to ${value < 0 ? 'left' : 'right'}, ${color}40 0%, ${color} 100%)`,
                        boxShadow: `0 0 12px ${color}50, inset 0 1px 0 rgba(255,255,255,0.1)`
                    }}
                />
                {/* Thumb with plastic look */}
                <div
                    className="absolute top-0.5 bottom-0.5 w-3 rounded-sm shadow-lg z-20 border border-white/20"
                    style={{ 
                        left: `calc(${percent}% - 6px)`,
                        background: `linear-gradient(180deg, #3a3a3a 0%, #1a1a1a 50%, #0a0a0a 100%)`,
                        boxShadow: `0 2px 6px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.15)`
                    }}
                >
                    {/* Thumb highlight */}
                    <div className="absolute top-0.5 left-0.5 right-0.5 h-px bg-white/30 rounded-full" />
                </div>
            </div>
        </div>
    );
};

// Harmonizer Popover Component
const HarmonizerPopover: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    config: HarmonizerConfig;
    isActive: boolean;
    onApply: (config: HarmonizerConfig, isActive: boolean) => void;
    colorHex: [number, number, number];
}> = ({ isOpen, onClose, config, isActive, onApply, colorHex }) => {
    const [localConfig, setLocalConfig] = useState<HarmonizerConfig>(config);
    const [localActive, setLocalActive] = useState(isActive);

    if (!isOpen) return null;

    const color = `rgba(${colorHex[0] * 255}, ${colorHex[1] * 255}, ${colorHex[2] * 255}, 1)`;

    const handleVoiceCountChange = (count: 2 | 3 | 4) => {
        setLocalConfig(prev => ({ ...prev, voiceCount: count }));
    };

    const handleHarmonyTypeChange = (type: HarmonyType) => {
        setLocalConfig(prev => ({ ...prev, harmonyType: type }));
    };

    const handleDetuneChange = (value: number) => {
        setLocalConfig(prev => ({ ...prev, detuneSpread: Math.round(value * 50) }));
    };

    const handleFormantChange = (value: number) => {
        setLocalConfig(prev => ({ ...prev, formantSpread: Math.round(value * 12) }));
    };

    const handleApply = () => {
        onApply(localConfig, localActive);
        onClose();
    };

    const harmonyTypes: { value: HarmonyType; label: string }[] = [
        { value: 'octave', label: 'OCTAVE' },
        { value: 'fifth', label: 'FIFTH' },
        { value: 'third', label: 'THIRD' },
        { value: 'cluster', label: 'CLUSTER' },
        { value: 'custom', label: 'CUSTOM' }
    ];

    return (
        <>
            {/* Backdrop */}
            <div 
                className="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm" 
                onClick={onClose}
            />
            
            {/* Popover with hardware panel aesthetic */}
            <div 
                className="absolute bottom-full right-0 mb-2 w-72 z-50 rounded-xl overflow-hidden border"
                style={{
                    background: 'linear-gradient(145deg, rgba(15,23,42,0.98), rgba(5,7,9,0.99))',
                    borderColor: `${color}50`,
                    boxShadow: `0 12px 40px rgba(0,0,0,0.9), 0 0 30px ${color}25, inset 0 1px 0 rgba(255,255,255,0.05)`
                }}
            >
                {/* Screw corners */}
                <div className="absolute top-2 left-2 w-2.5 h-2.5 rounded-full bg-zinc-800 border border-zinc-600 flex items-center justify-center">
                    <div className="w-1.5 h-[1px] bg-zinc-500 rotate-45" />
                </div>
                <div className="absolute top-2 right-2 w-2.5 h-2.5 rounded-full bg-zinc-800 border border-zinc-600 flex items-center justify-center">
                    <div className="w-1.5 h-[1px] bg-zinc-500 rotate-45" />
                </div>
                <div className="absolute bottom-2 left-2 w-2.5 h-2.5 rounded-full bg-zinc-800 border border-zinc-600 flex items-center justify-center">
                    <div className="w-1.5 h-[1px] bg-zinc-500 rotate-45" />
                </div>
                <div className="absolute bottom-2 right-2 w-2.5 h-2.5 rounded-full bg-zinc-800 border border-zinc-600 flex items-center justify-center">
                    <div className="w-1.5 h-[1px] bg-zinc-500 rotate-45" />
                </div>

                {/* Header with holographic gradient */}
                <div 
                    className="px-4 py-3 border-b flex items-center justify-between relative overflow-hidden"
                    style={{ borderColor: `${color}40` }}
                >
                    {/* Holographic header background */}
                    <div className="absolute inset-0 opacity-30" style={{
                        background: `linear-gradient(90deg, transparent 0%, ${color}30 50%, transparent 100%)`
                    }} />
                    <span className="text-xs font-bold font-orbitron tracking-wider relative z-10 flex items-center gap-1.5" style={{ color, textShadow: `0 0 10px ${color}60` }}>
                        <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: color, boxShadow: `0 0 8px ${color}` }} />
                        HARMONIZER
                    </span>
                    {/* Toggle switch style ON/OFF button */}
                    <button 
                        onClick={() => setLocalActive(!localActive)}
                        className={`relative px-3 py-1 rounded-full text-[9px] font-bold transition-all border ${
                            localActive 
                                ? 'bg-green-500/20 text-green-400 border-green-500/50 shadow-[0_0_10px_rgba(34,197,94,0.3)]' 
                                : 'bg-zinc-800 text-zinc-500 border-zinc-600'
                        }`}
                    >
                        <span className="flex items-center gap-1.5">
                            {localActive && <span className="w-1 h-1 rounded-full bg-green-400 shadow-[0_0_4px_rgba(74,222,128,0.8)]" />}
                            {localActive ? 'ON' : 'OFF'}
                        </span>
                    </button>
                </div>

                {/* Content */}
                <div className="p-4 space-y-4">
                    {/* Voice Count - Toggle switch style */}
                    <div className="space-y-2">
                        <span className="text-[9px] font-mono text-gray-400 uppercase tracking-wider">Voices</span>
                        <div className="flex gap-2 bg-zinc-950/50 p-1 rounded-lg border border-zinc-800">
                            {[2, 3, 4].map(count => (
                                <button
                                    key={count}
                                    onClick={() => handleVoiceCountChange(count as 2 | 3 | 4)}
                                    className={`flex-1 py-1.5 rounded-md text-[10px] font-bold transition-all ${
                                        localConfig.voiceCount === count
                                            ? 'text-black shadow-lg'
                                            : 'text-zinc-500 hover:text-zinc-300'
                                    }`}
                                    style={localConfig.voiceCount === count ? { 
                                        backgroundColor: color,
                                        boxShadow: `0 0 15px ${color}60, inset 0 1px 0 rgba(255,255,255,0.2)`
                                    } : undefined}
                                >
                                    {count}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Harmony Type - 3D button style */}
                    <div className="space-y-2">
                        <span className="text-[9px] font-mono text-gray-400 uppercase tracking-wider">Harmony Type</span>
                        <div className="grid grid-cols-2 gap-1.5">
                            {harmonyTypes.map(({ value, label }) => (
                                <button
                                    key={value}
                                    onClick={() => handleHarmonyTypeChange(value)}
                                    className={`py-1.5 rounded-md text-[9px] font-bold transition-all relative overflow-hidden ${
                                        localConfig.harmonyType === value
                                            ? 'text-white'
                                            : 'bg-zinc-800/80 text-zinc-400 border border-zinc-700 hover:bg-zinc-700/80 hover:border-zinc-600'
                                    }`}
                                    style={localConfig.harmonyType === value ? { 
                                        background: `linear-gradient(135deg, ${color}50 0%, ${color}30 100%)`,
                                        border: `1px solid ${color}`,
                                        boxShadow: `0 0 12px ${color}40, inset 0 1px 0 rgba(255,255,255,0.1)`
                                    } : undefined}
                                >
                                    {label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Detune Spread - Styled slider */}
                    <div className="space-y-2">
                        <div className="flex justify-between items-center">
                            <span className="text-[9px] font-mono text-gray-400 uppercase tracking-wider">Detune</span>
                            <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded bg-zinc-950 border border-zinc-800" style={{ color, textShadow: `0 0 8px ${color}40` }}>
                                {localConfig.detuneSpread}¢
                            </span>
                        </div>
                        <div className="relative h-5 bg-zinc-900 rounded-md border border-zinc-700 overflow-hidden shadow-[inset_0_2px_4px_rgba(0,0,0,0.5)]">
                            <div 
                                className="absolute inset-y-0.5 left-0.5 rounded-sm transition-all"
                                style={{
                                    width: `${localConfig.detuneSpread * 2}%`,
                                    background: `linear-gradient(90deg, ${color}40 0%, ${color} 100%)`,
                                    boxShadow: `0 0 10px ${color}40`
                                }}
                            />
                            <input
                                type="range"
                                min="0"
                                max="50"
                                value={localConfig.detuneSpread}
                                onChange={(e) => handleDetuneChange(parseInt(e.target.value) / 50)}
                                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                            />
                        </div>
                    </div>

                    {/* Formant Spread - Styled slider */}
                    <div className="space-y-2">
                        <div className="flex justify-between items-center">
                            <span className="text-[9px] font-mono text-gray-400 uppercase tracking-wider">Formant</span>
                            <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded bg-zinc-950 border border-zinc-800" style={{ color, textShadow: `0 0 8px ${color}40` }}>
                                {localConfig.formantSpread}st
                            </span>
                        </div>
                        <div className="relative h-5 bg-zinc-900 rounded-md border border-zinc-700 overflow-hidden shadow-[inset_0_2px_4px_rgba(0,0,0,0.5)]">
                            <div 
                                className="absolute inset-y-0.5 left-0.5 rounded-sm transition-all"
                                style={{
                                    width: `${(localConfig.formantSpread / 12) * 100}%`,
                                    background: `linear-gradient(90deg, ${color}40 0%, ${color} 100%)`,
                                    boxShadow: `0 0 10px ${color}40`
                                }}
                            />
                            <input
                                type="range"
                                min="0"
                                max="12"
                                value={localConfig.formantSpread}
                                onChange={(e) => handleFormantChange(parseInt(e.target.value) / 12)}
                                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                            />
                        </div>
                    </div>

                    {/* Presets - Hardware button style */}
                    <div className="pt-2 border-t border-zinc-800/50">
                        <span className="text-[8px] font-mono text-gray-500 uppercase tracking-wider">Quick Presets</span>
                        <div className="flex gap-1.5 mt-2">
                            {[
                                { key: 'subtle', label: 'DBL' },
                                { key: 'classic', label: '3RD' },
                                { key: 'choir', label: 'CHR' },
                                { key: 'power', label: '5TH' }
                            ].map(({ key, label }) => (
                                <button
                                    key={key}
                                    onClick={() => setLocalConfig(HARMONIZE_PRESETS[key as keyof typeof HARMONIZE_PRESETS]())}
                                    className="flex-1 py-1.5 rounded-md text-[8px] font-bold bg-gradient-to-b from-zinc-800 to-zinc-900 text-zinc-400 border border-zinc-700 hover:text-zinc-200 transition-all shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]"
                                >
                                    {label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Apply Button - Animated hardware style */}
                    <button
                        onClick={handleApply}
                        className="w-full py-2.5 rounded-lg text-xs font-bold font-orbitron tracking-wider transition-all text-black relative overflow-hidden group"
                        style={{
                            background: `linear-gradient(135deg, ${color} 0%, ${color}dd 50%, ${color} 100%)`,
                            boxShadow: `0 4px 20px ${color}50, inset 0 1px 0 rgba(255,255,255,0.2)`
                        }}
                        onMouseEnter={(e) => {
                            e.currentTarget.style.boxShadow = `0 6px 25px ${color}70, inset 0 1px 0 rgba(255,255,255,0.3)`;
                            e.currentTarget.style.transform = 'translateY(-1px)';
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.boxShadow = `0 4px 20px ${color}50, inset 0 1px 0 rgba(255,255,255,0.2)`;
                            e.currentTarget.style.transform = 'translateY(0)';
                        }}
                    >
                        {/* Shine effect */}
                        <span className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-500" />
                        <span className="relative flex items-center justify-center gap-2">
                            APPLY <span className="text-sm">✦</span>
                        </span>
                    </button>
                </div>
            </div>
        </>
    );
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
    const [localQuality, setLocalQuality] = useState(quality);
    const [localStretch, setLocalStretch] = useState(stretchMode);
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
            // @ts-expect-error - Auto-generated to fix CI build
            case 'quality': setLocalQuality(value as string); break;
            // @ts-expect-error - Auto-generated to fix CI build
            case 'stretchMode': setLocalStretch(value as string); break;
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
