import React, { useState } from 'react';
import { type HarmonizerConfig, type HarmonyType, HARMONIZE_PRESETS } from '../../engines/Harmonizer';

export interface HarmonizerPopoverProps {
    isOpen: boolean;
    onClose: () => void;
    config: HarmonizerConfig;
    isActive: boolean;
    onApply: (config: HarmonizerConfig, isActive: boolean) => void;
    colorHex: [number, number, number];
}

// ⚡ Bolt: Added React.memo to prevent unnecessary re-renders when parent state changes.
export const HarmonizerPopover: React.FC<HarmonizerPopoverProps> = React.memo(({ isOpen, onClose, config, isActive, onApply, colorHex }) => {
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

    const handleBusGainChange = (value: number) => {
        setLocalConfig(prev => ({ ...prev, busGain: value }));
    };

    const handleBusCompressorThresholdChange = (value: number) => {
        setLocalConfig(prev => ({ ...prev, busCompressorThreshold: value }));
    };

    const handleBusEqGainChange = (value: number) => {
        setLocalConfig(prev => ({ ...prev, busEqGain: value }));
    };

    const handleBusWidenerChange = (value: number) => {
        setLocalConfig(prev => ({ ...prev, busWidener: value }));
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
                id="harmonizer-dialog"
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
                    <button type="button"
                        onClick={() => setLocalActive(!localActive)}
                        aria-label={localActive ? 'Disable Harmonizer' : 'Enable Harmonizer'}
                        className={`relative px-3 py-1 rounded-full text-[9px] font-bold transition-all border focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-900 focus-visible:ring-cyan-500 ${
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
                        <span id="voice-count-label" className="text-[9px] font-mono text-gray-400 uppercase tracking-wider">Voices</span>
                        <div role="radiogroup" aria-labelledby="voice-count-label" className="flex gap-2 bg-zinc-950/50 p-1 rounded-lg border border-zinc-800">
                            {[2, 3, 4].map(count => (
                                <button type="button"
                                    key={count}
                                    role="radio"
                                    onClick={() => handleVoiceCountChange(count as 2 | 3 | 4)}
                                    aria-label={`${count} Voices`}
                                    aria-checked={localConfig.voiceCount === count}
                                    className={`flex-1 py-1.5 rounded-md text-[10px] font-bold transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-900 focus-visible:ring-cyan-500 ${
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
                        <span id="harmony-type-label" className="text-[9px] font-mono text-gray-400 uppercase tracking-wider">Harmony Type</span>
                        <div role="radiogroup" aria-labelledby="harmony-type-label" className="grid grid-cols-2 gap-1.5">
                            {harmonyTypes.map(({ value, label }) => (
                                <button type="button"
                                    key={value}
                                    role="radio"
                                    onClick={() => handleHarmonyTypeChange(value)}
                                    aria-label={`${label} Harmony`}
                                    aria-checked={localConfig.harmonyType === value}
                                    className={`py-1.5 rounded-md text-[9px] font-bold transition-all relative overflow-hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-900 focus-visible:ring-cyan-500 ${
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
                                aria-label="Detune Spread"
                                aria-valuetext={`${localConfig.detuneSpread} cents`}
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
                                aria-label="Formant Spread"
                                aria-valuetext={`${localConfig.formantSpread} semitones`}
                            />
                        </div>
                    </div>

                    {/* Bus Gain - Styled slider */}
                    <div className="space-y-2">
                        <div className="flex justify-between items-center">
                            <span className="text-[9px] font-mono text-gray-400 uppercase tracking-wider">Bus Gain</span>
                            <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded bg-zinc-950 border border-zinc-800" style={{ color, textShadow: `0 0 8px ${color}40` }}>
                                {Math.round((localConfig.busGain ?? 0.85) * 100)}%
                            </span>
                        </div>
                        <div className="relative h-5 bg-zinc-900 rounded-md border border-zinc-700 overflow-hidden shadow-[inset_0_2px_4px_rgba(0,0,0,0.5)]">
                            <div
                                className="absolute inset-y-0.5 left-0.5 rounded-sm transition-all"
                                style={{
                                    width: `${(localConfig.busGain ?? 0.85) * 100}%`,
                                    background: `linear-gradient(90deg, ${color}40 0%, ${color} 100%)`,
                                    boxShadow: `0 0 10px ${color}40`
                                }}
                            />
                            <input
                                type="range"
                                min="0"
                                max="100"
                                value={Math.round((localConfig.busGain ?? 0.85) * 100)}
                                onChange={(e) => handleBusGainChange(parseInt(e.target.value) / 100)}
                                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                                aria-label="Harmony Bus Gain"
                                aria-valuetext={`${Math.round((localConfig.busGain ?? 0.85) * 100)} percent`}
                            />
                        </div>
                    </div>

                    {/* Bus Compressor Threshold - Styled slider */}
                    <div className="space-y-2">
                        <div className="flex justify-between items-center">
                            <span className="text-[9px] font-mono text-gray-400 uppercase tracking-wider">Comp Thresh</span>
                            <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded bg-zinc-950 border border-zinc-800" style={{ color, textShadow: `0 0 8px ${color}40` }}>
                                {localConfig.busCompressorThreshold ?? -18}dB
                            </span>
                        </div>
                        <div className="relative h-5 bg-zinc-900 rounded-md border border-zinc-700 overflow-hidden shadow-[inset_0_2px_4px_rgba(0,0,0,0.5)]">
                            <div
                                className="absolute inset-y-0.5 left-0.5 rounded-sm transition-all"
                                style={{
                                    width: `${((localConfig.busCompressorThreshold ?? -18) + 60) / 60 * 100}%`,
                                    background: `linear-gradient(90deg, ${color}40 0%, ${color} 100%)`,
                                    boxShadow: `0 0 10px ${color}40`
                                }}
                            />
                            <input
                                type="range"
                                min="-60"
                                max="0"
                                value={localConfig.busCompressorThreshold ?? -18}
                                onChange={(e) => handleBusCompressorThresholdChange(parseInt(e.target.value))}
                                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                                aria-label="Bus Compressor Threshold"
                                aria-valuetext={`${localConfig.busCompressorThreshold ?? -18} dB`}
                            />
                        </div>
                    </div>

                    {/* Bus EQ Gain - Styled slider */}
                    <div className="space-y-2">
                        <div className="flex justify-between items-center">
                            <span className="text-[9px] font-mono text-gray-400 uppercase tracking-wider">EQ Low Gain</span>
                            <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded bg-zinc-950 border border-zinc-800" style={{ color, textShadow: `0 0 8px ${color}40` }}>
                                {localConfig.busEqGain ?? -3.0}dB
                            </span>
                        </div>
                        <div className="relative h-5 bg-zinc-900 rounded-md border border-zinc-700 overflow-hidden shadow-[inset_0_2px_4px_rgba(0,0,0,0.5)]">
                            <div
                                className="absolute inset-y-0.5 left-0.5 rounded-sm transition-all"
                                style={{
                                    width: `${((localConfig.busEqGain ?? -3.0) + 24) / 48 * 100}%`,
                                    background: `linear-gradient(90deg, ${color}40 0%, ${color} 100%)`,
                                    boxShadow: `0 0 10px ${color}40`
                                }}
                            />
                            <input
                                type="range"
                                min="-24"
                                max="24"
                                step="0.1"
                                value={localConfig.busEqGain ?? -3.0}
                                onChange={(e) => handleBusEqGainChange(parseFloat(e.target.value))}
                                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                                aria-label="Bus EQ Low Gain"
                                aria-valuetext={`${localConfig.busEqGain ?? -3.0} dB`}
                            />
                        </div>
                    </div>

                    {/* Bus Widener - Styled slider */}
                    <div className="space-y-2">
                        <div className="flex justify-between items-center">
                            <span className="text-[9px] font-mono text-gray-400 uppercase tracking-wider">Stereo Width</span>
                            <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded bg-zinc-950 border border-zinc-800" style={{ color, textShadow: `0 0 8px ${color}40` }}>
                                {Math.round((localConfig.busWidener ?? 0.0) * 100)}%
                            </span>
                        </div>
                        <div className="relative h-5 bg-zinc-900 rounded-md border border-zinc-700 overflow-hidden shadow-[inset_0_2px_4px_rgba(0,0,0,0.5)]">
                            <div
                                className="absolute inset-y-0.5 left-0.5 rounded-sm transition-all"
                                style={{
                                    width: `${(localConfig.busWidener ?? 0.0) * 100}%`,
                                    background: `linear-gradient(90deg, ${color}40 0%, ${color} 100%)`,
                                    boxShadow: `0 0 10px ${color}40`
                                }}
                            />
                            <input
                                type="range"
                                min="0"
                                max="100"
                                value={Math.round((localConfig.busWidener ?? 0.0) * 100)}
                                onChange={(e) => handleBusWidenerChange(parseInt(e.target.value) / 100)}
                                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                                aria-label="Bus Stereo Width"
                                aria-valuetext={`${Math.round((localConfig.busWidener ?? 0.0) * 100)} percent`}
                            />
                        </div>
                    </div>

                    {/* Presets - Hardware button style */}
                    <div className="pt-2 border-t border-zinc-800/50">
                        <span className="text-[8px] font-mono text-gray-500 uppercase tracking-wider">Quick Presets</span>
                        <div className="flex gap-1.5 mt-2">
                            {[
                                { key: 'subtle', label: 'DBL', desc: 'Double (Subtle)' },
                                { key: 'classic', label: '3RD', desc: '3rd Harmony (Classic)' },
                                { key: 'choir', label: 'CHR', desc: 'Choir (Thick)' },
                                { key: 'power', label: '5TH', desc: '5th Harmony (Power)' }
                            ].map(({ key, label, desc }) => (
                                <button type="button"
                                    key={key}
                                    onClick={() => setLocalConfig(HARMONIZE_PRESETS[key as keyof typeof HARMONIZE_PRESETS]())}
                                    className="flex-1 py-1.5 rounded-md text-[8px] font-bold bg-gradient-to-b from-zinc-800 to-zinc-900 text-zinc-400 border border-zinc-700 hover:text-zinc-200 transition-all shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-900 focus-visible:ring-cyan-500"
                                    title={desc}
                                    aria-label={`Apply ${desc} Preset`}
                                >
                                    {label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Apply Button - Animated hardware style */}
                    <button type="button"
                        onClick={handleApply}
                        aria-label="Apply Harmonizer Settings"
                        title="Apply Harmonizer Settings"
                        className="w-full py-2.5 rounded-lg text-xs font-bold font-orbitron tracking-wider transition-all text-black relative overflow-hidden group focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-900 focus-visible:ring-cyan-500"
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
});
