import React, { useState, useCallback } from 'react';
import { HardwareModule, KnobConfig } from './HardwareModule';
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
        className={`w-8 h-5 text-[9px] font-mono font-bold rounded transition-all ${
            isActive
                ? 'bg-cyan-500 text-black shadow-[0_0_8px_rgba(6,182,212,0.6)]'
                : 'bg-zinc-800 text-zinc-500 border border-zinc-700 hover:bg-zinc-700 hover:text-zinc-400'
        }`}
    >
        {note}
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
            <span className="text-[9px] font-mono text-gray-400">{label}</span>
            <div
                className="w-6 rounded-full bg-zinc-900 border-2 border-zinc-700 cursor-ns-resize relative overflow-hidden shadow-[inset_0_2px_4px_rgba(0,0,0,0.5)]"
                style={{ height: `${height}px` }}
                onMouseDown={handleMouseDown}
            >
                {/* Fill */}
                <div
                    className="absolute bottom-0 left-0 right-0 rounded-b-full transition-all"
                    style={{
                        height: `${fillHeight}px`,
                        background: `linear-gradient(to top, ${color}, ${color}80)`,
                        boxShadow: `0 0 10px ${color}60`
                    }}
                />
                {/* Center marker */}
                <div className="absolute left-0 right-0 h-px bg-white/30 top-1/2" />
            </div>
            <span className="text-[8px] font-mono text-gray-500">{Math.round(value * 100)}%</span>
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
        <div className="flex flex-col gap-1 w-full">
            <div className="flex justify-between items-center">
                <span className="text-[9px] font-mono text-gray-400">{label}</span>
                <span className="text-[9px] font-mono font-bold" style={{ color }}>{displayValue}</span>
            </div>
            <div
                className="h-4 bg-zinc-900 rounded border border-zinc-700 cursor-ew-resize relative overflow-hidden shadow-[inset_0_1px_3px_rgba(0,0,0,0.5)]"
                onMouseDown={handleMouseDown}
            >
                {/* Center line */}
                <div className="absolute left-1/2 top-0 bottom-0 w-px bg-white/20 z-10" />
                {/* Fill from center */}
                <div
                    className="absolute top-0 bottom-0 transition-all"
                    style={{
                        left: value < 0 ? `${percent}%` : '50%',
                        right: value > 0 ? `${100 - percent}%` : '50%',
                        background: `linear-gradient(to ${value < 0 ? 'left' : 'right'}, ${color}60, ${color})`,
                        boxShadow: `0 0 8px ${color}40`
                    }}
                />
                {/* Thumb */}
                <div
                    className="absolute top-0 bottom-0 w-2 bg-white rounded shadow-md z-20"
                    style={{ left: `calc(${percent}% - 4px)` }}
                />
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
                className="fixed inset-0 z-40" 
                onClick={onClose}
            />
            
            {/* Popover */}
            <div 
                className="absolute bottom-full right-0 mb-2 w-64 z-50 rounded-xl overflow-hidden shadow-2xl border"
                style={{
                    background: 'linear-gradient(145deg, rgba(15,23,42,0.98), rgba(5,7,9,0.99))',
                    borderColor: `${color}60`,
                    boxShadow: `0 8px 32px rgba(0,0,0,0.8), 0 0 20px ${color}30`
                }}
            >
                {/* Header */}
                <div 
                    className="px-4 py-2 border-b flex items-center justify-between"
                    style={{ borderColor: `${color}40`, background: `linear-gradient(90deg, ${color}20, transparent)` }}
                >
                    <span className="text-xs font-bold font-orbitron tracking-wider" style={{ color }}>
                        ✧ HARMONIZER
                    </span>
                    <button 
                        onClick={() => setLocalActive(!localActive)}
                        className={`px-2 py-0.5 rounded text-[10px] font-bold transition-all ${
                            localActive 
                                ? 'bg-green-500/30 text-green-400 border border-green-500/50' 
                                : 'bg-zinc-800 text-zinc-500 border border-zinc-700'
                        }`}
                    >
                        {localActive ? 'ON' : 'OFF'}
                    </button>
                </div>

                {/* Content */}
                <div className="p-3 space-y-3">
                    {/* Voice Count */}
                    <div className="space-y-1.5">
                        <span className="text-[9px] font-mono text-gray-400 uppercase tracking-wider">Voices</span>
                        <div className="flex gap-1">
                            {[2, 3, 4].map(count => (
                                <button
                                    key={count}
                                    onClick={() => handleVoiceCountChange(count as 2 | 3 | 4)}
                                    className={`flex-1 py-1.5 rounded text-[10px] font-bold transition-all ${
                                        localConfig.voiceCount === count
                                            ? 'text-black shadow-lg'
                                            : 'bg-zinc-800 text-zinc-400 border border-zinc-700 hover:bg-zinc-700'
                                    }`}
                                    style={localConfig.voiceCount === count ? { 
                                        backgroundColor: color,
                                        boxShadow: `0 0 10px ${color}80`
                                    } : undefined}
                                >
                                    {count}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Harmony Type */}
                    <div className="space-y-1.5">
                        <span className="text-[9px] font-mono text-gray-400 uppercase tracking-wider">Harmony Type</span>
                        <div className="grid grid-cols-2 gap-1">
                            {harmonyTypes.map(({ value, label }) => (
                                <button
                                    key={value}
                                    onClick={() => handleHarmonyTypeChange(value)}
                                    className={`py-1 rounded text-[9px] font-bold transition-all ${
                                        localConfig.harmonyType === value
                                            ? 'text-white border'
                                            : 'bg-zinc-800/80 text-zinc-400 border border-zinc-700 hover:bg-zinc-700'
                                    }`}
                                    style={localConfig.harmonyType === value ? { 
                                        borderColor: color,
                                        background: `linear-gradient(135deg, ${color}40, ${color}20)`,
                                        boxShadow: `0 0 8px ${color}40`
                                    } : undefined}
                                >
                                    {label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Detune Spread */}
                    <div className="space-y-1">
                        <div className="flex justify-between">
                            <span className="text-[9px] font-mono text-gray-400">DETUNE</span>
                            <span className="text-[9px] font-mono font-bold" style={{ color }}>
                                {localConfig.detuneSpread}¢
                            </span>
                        </div>
                        <input
                            type="range"
                            min="0"
                            max="50"
                            value={localConfig.detuneSpread}
                            onChange={(e) => handleDetuneChange(parseInt(e.target.value) / 50)}
                            className="w-full h-1.5 bg-zinc-800 rounded-full appearance-none cursor-pointer"
                            style={{
                                background: `linear-gradient(to right, ${color} 0%, ${color} ${localConfig.detuneSpread * 2}%, #27272a ${localConfig.detuneSpread * 2}%, #27272a 100%)`
                            }}
                        />
                    </div>

                    {/* Formant Spread */}
                    <div className="space-y-1">
                        <div className="flex justify-between">
                            <span className="text-[9px] font-mono text-gray-400">FORMANT</span>
                            <span className="text-[9px] font-mono font-bold" style={{ color }}>
                                {localConfig.formantSpread}st
                            </span>
                        </div>
                        <input
                            type="range"
                            min="0"
                            max="12"
                            value={localConfig.formantSpread}
                            onChange={(e) => handleFormantChange(parseInt(e.target.value) / 12)}
                            className="w-full h-1.5 bg-zinc-800 rounded-full appearance-none cursor-pointer"
                            style={{
                                background: `linear-gradient(to right, ${color} 0%, ${color} ${localConfig.formantSpread * 8.33}%, #27272a ${localConfig.formantSpread * 8.33}%, #27272a 100%)`
                            }}
                        />
                    </div>

                    {/* Presets */}
                    <div className="pt-1 border-t border-zinc-800">
                        <span className="text-[8px] font-mono text-gray-500 uppercase">Quick Presets</span>
                        <div className="flex gap-1 mt-1.5">
                            {[
                                { key: 'subtle', label: 'DBL' },
                                { key: 'classic', label: '3RD' },
                                { key: 'choir', label: 'CHR' },
                                { key: 'power', label: '5TH' }
                            ].map(({ key, label }) => (
                                <button
                                    key={key}
                                    onClick={() => setLocalConfig(HARMONIZE_PRESETS[key as keyof typeof HARMONIZE_PRESETS]())}
                                    className="flex-1 py-1 rounded text-[8px] font-bold bg-zinc-800/60 text-zinc-500 border border-zinc-700 hover:bg-zinc-700/60 hover:text-zinc-300 transition-all"
                                >
                                    {label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Apply Button */}
                    <button
                        onClick={handleApply}
                        className="w-full py-2 rounded-lg text-xs font-bold font-orbitron tracking-wider transition-all text-black"
                        style={{
                            background: `linear-gradient(135deg, ${color}, ${color}80)`,
                            boxShadow: `0 4px 15px ${color}60`
                        }}
                        onMouseEnter={(e) => {
                            e.currentTarget.style.boxShadow = `0 6px 20px ${color}80`;
                            e.currentTarget.style.transform = 'translateY(-1px)';
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.boxShadow = `0 4px 15px ${color}60`;
                            e.currentTarget.style.transform = 'translateY(0)';
                        }}
                    >
                        APPLY ✦
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
            case 'quality': setLocalQuality(value as string); break;
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
            <div className="h-[180px] bg-gradient-to-b from-zinc-900 to-black border-t-2 border-purple-500/30 p-3 flex gap-4 shrink-0">
                {/* Left: Root Note Ladder */}
                <div className="flex flex-col items-center gap-1 w-12">
                    <span className="text-[9px] font-mono text-purple-400 font-bold tracking-wider">ROOT</span>
                    <div className="flex flex-col gap-0.5">
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
                <div className="flex flex-col gap-2 w-40">
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
                <div className="flex flex-col gap-2 flex-1">
                    {/* Pitch Envelope */}
                    <div className="flex items-center gap-3">
                        <span className="text-[9px] font-mono text-purple-400 font-bold">PITCH ENV</span>
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
                    <div className="h-px bg-purple-500/20 my-1" />

                    {/* RubberBand Section */}
                    <div className="flex flex-col gap-1.5">
                        <span className="text-[9px] font-mono text-cyan-400 font-bold tracking-wider">RUBBERBAND</span>
                        
                        <div className="flex gap-2">
                            <select
                                value={localQuality}
                                onChange={(e) => handleParamChange('quality', e.target.value)}
                                className="flex-1 bg-zinc-950 text-[10px] text-gray-300 border border-zinc-700 rounded px-2 py-1 outline-none focus:border-cyan-500"
                            >
                                <option value="preview">Preview</option>
                                <option value="good">Good</option>
                                <option value="better">Better</option>
                                <option value="best">Best</option>
                            </select>

                            <select
                                value={localStretch}
                                onChange={(e) => handleParamChange('stretchMode', e.target.value)}
                                className="flex-1 bg-zinc-950 text-[10px] text-gray-300 border border-zinc-700 rounded px-2 py-1 outline-none focus:border-cyan-500"
                            >
                                <option value="precise">Precise</option>
                                <option value="elastic">Elastic</option>
                                <option value="hybrid">Hybrid</option>
                            </select>
                        </div>

                        <label className="flex items-center gap-2 cursor-pointer mt-1">
                            <div className={`w-8 h-4 rounded-full border transition-all ${localLock ? 'bg-cyan-600 border-cyan-400' : 'bg-zinc-800 border-zinc-600'}`}>
                                <div className={`w-3 h-3 rounded-full bg-white transition-all ${localLock ? 'translate-x-4' : 'translate-x-0.5'} mt-0.5`} />
                            </div>
                            <input
                                type="checkbox"
                                checked={localLock}
                                onChange={(e) => handleParamChange('lockToSequencer', e.target.checked)}
                                className="sr-only"
                            />
                            <span className="text-[10px] font-mono text-gray-400">LOCK TO SEQUENCER NOTES</span>
                        </label>
                    </div>

                    {/* Divider */}
                    <div className="h-px bg-purple-500/20 my-1" />

                    {/* Harmonizer Section */}
                    <div className="relative">
                        <div className="flex items-center justify-between">
                            <span className="text-[9px] font-mono font-bold tracking-wider" style={{ color }}>
                                HARMONIZER
                            </span>
                            
                            {/* HARMONIZE Button */}
                            <div className="relative">
                                <button
                                    onClick={() => setIsHarmonizerOpen(!isHarmonizerOpen)}
                                    className={`px-3 py-1.5 rounded-lg text-[10px] font-bold font-orbitron tracking-wider transition-all border ${
                                        isHarmonizeActive
                                            ? 'text-black shadow-lg'
                                            : 'bg-zinc-900 text-zinc-400 border-zinc-700 hover:bg-zinc-800 hover:text-zinc-300'
                                    }`}
                                    style={isHarmonizeActive ? {
                                        background: `linear-gradient(135deg, ${color}, ${color}80)`,
                                        borderColor: color,
                                        boxShadow: `0 0 15px ${color}60`
                                    } : undefined}
                                >
                                    {isHarmonizeActive ? '✦ HARMONIZE' : 'HARMONIZE'}
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

                        {/* Active Harmonize Indicator */}
                        {isHarmonizeActive && (
                            <div className="flex items-center gap-2 mt-1.5">
                                <div 
                                    className="w-1.5 h-1.5 rounded-full animate-pulse"
                                    style={{ backgroundColor: color, boxShadow: `0 0 8px ${color}` }}
                                />
                                <span className="text-[9px] font-mono text-gray-400">
                                    {(harmonizerConfig?.voiceCount || 2)}V 
                                    {(harmonizerConfig?.harmonyType || 'third').toUpperCase()} 
                                    • {(harmonizerConfig?.detuneSpread || 15)}¢ 
                                    • {(harmonizerConfig?.formantSpread || 3)}st
                                </span>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};
