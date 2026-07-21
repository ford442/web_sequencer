import type { KnobConfig } from '@/components/HardwareModule';
import type { SynthParams, KickParams, SnareParams, SamplerBankParams, Bass2Params, HatParams } from '@/types';

export const getBass2Controls = (params: Bass2Params): KnobConfig[] => {
    const filterModeValue = params.filterMode ?? 0;
    return [
        { id: 'waveform', label: 'WAVE', x: 0.10, y: 0.25, size: 0.08, value: params.waveform === '303-sqr' ? 1 : 0, valueDisplay: params.waveform === '303-sqr' ? 'SQR' : 'SAW' },
        { id: 'cutoff', label: 'CUTOFF', x: 0.30, y: 0.25, size: 0.12, value: params.cutoff / 8000, valueDisplay: `${Math.round(params.cutoff)}Hz` },
        { id: 'resonance', label: 'RES', x: 0.50, y: 0.25, size: 0.12, value: params.resonance / 20, valueDisplay: `${params.resonance.toFixed(1)}` },
        { id: 'filterMode', label: 'MODE', x: 0.70, y: 0.25, size: 0.08, value: filterModeValue, valueDisplay: filterModeValue > 0 ? '24dB' : '18dB' },
        { id: 'decay', label: 'DECAY', x: 0.25, y: 0.55, size: 0.11, value: (params.decay ?? 0) / 2, valueDisplay: `${(params.decay ?? 0).toFixed(2)}s` },
        { id: 'accent', label: 'ACCENT', x: 0.45, y: 0.55, size: 0.11, value: params.accent, valueDisplay: `${Math.round(params.accent * 100)}%` },
        { id: 'envMod', label: 'ENV MOD', x: 0.65, y: 0.55, size: 0.11, value: params.envMod, valueDisplay: `${Math.round(params.envMod * 100)}%` },
        { id: 'pitch', label: 'TUNE', x: 0.10, y: 0.80, size: 0.09, value: (params.pitch + 24) / 48, valueDisplay: `${params.pitch > 0 ? '+' : ''}${params.pitch.toFixed(0)}st` },
        { id: 'drive', label: 'DRIVE', x: 0.30, y: 0.80, size: 0.09, value: params.drive ?? 0, valueDisplay: `${Math.round((params.drive ?? 0) * 100)}%` },
        { id: 'volume', label: 'LEVEL', x: 0.85, y: 0.80, size: 0.10, value: params.volume, valueDisplay: `${Math.round(params.volume * 100)}%` },
    ];
};

export const getSynthControls = (params: SynthParams): KnobConfig[] => {
    const filterModeValue = params.filterMode ?? 0;
    return [
        { id: 'attack', label: 'ATK', x: 0.20, y: 0.25, size: 0.08, value: (params.attack ?? 0), valueDisplay: `${(params.attack ?? 0).toFixed(2)}s` },
        { id: 'decay', label: 'DEC', x: 0.35, y: 0.25, size: 0.08, value: (params.decay ?? 0) / 2, valueDisplay: `${(params.decay ?? 0).toFixed(2)}s` },
        { id: 'sustain', label: 'SUS', x: 0.50, y: 0.25, size: 0.08, value: params.sustain, valueDisplay: `${Math.round(params.sustain * 100)}%` },
        { id: 'release', label: 'REL', x: 0.65, y: 0.25, size: 0.08, value: params.release / 2, valueDisplay: `${params.release.toFixed(2)}s` },
        { id: 'filterCutoff', label: 'CUTOFF', x: 0.35, y: 0.60, size: 0.12, value: params.filterCutoff / 8000, valueDisplay: `${Math.round(params.filterCutoff)}Hz` },
        { id: 'filterResonance', label: 'RES', x: 0.50, y: 0.60, size: 0.12, value: params.filterResonance / 20, valueDisplay: `${params.filterResonance.toFixed(1)}` },
        { id: 'filterMode', label: 'MODE', x: 0.65, y: 0.60, size: 0.08, value: filterModeValue, valueDisplay: filterModeValue > 0 ? '24dB' : '18dB' },
        { id: 'pitch', label: 'TUNE', x: 0.10, y: 0.50, size: 0.09, value: (params.pitch + 24) / 48, valueDisplay: `${params.pitch > 0 ? '+' : ''}${params.pitch.toFixed(1)}st` },
        { id: 'drive', label: 'DRIVE', x: 0.10, y: 0.80, size: 0.09, value: params.drive ?? 0, valueDisplay: `${Math.round((params.drive ?? 0) * 100)}%` },
        { id: 'length', label: 'GATE', x: 0.75, y: 0.50, size: 0.09, value: (params.length || 0.25) / 2, valueDisplay: `${(params.length || 0.25).toFixed(2)}s` },
        { id: 'volume', label: 'LEVEL', x: 0.90, y: 0.50, size: 0.10, value: params.volume, valueDisplay: `${Math.round(params.volume * 100)}%` },
        { id: 'delayMix', label: 'DLY MIX', x: 0.85, y: 0.80, size: 0.07, value: params.delayMix, valueDisplay: `${Math.round(params.delayMix * 100)}%` },
        { id: 'delayTime', label: 'DLY TIME', x: 0.95, y: 0.80, size: 0.07, value: params.delayTime, valueDisplay: `${params.delayTime.toFixed(2)}s` },
    ];
};

export const getKickControls = (params: KickParams): KnobConfig[] => [
    { id: 'pitch', label: 'TUNE', x: 0.2, y: 0.45, size: 0.13, value: (params.pitch - 20) / 130, valueDisplay: `${Math.round(params.pitch)}Hz` },
    { id: 'decay', label: 'DECAY', x: 0.5, y: 0.45, size: 0.13, value: (params.decay ?? 0), valueDisplay: `${(params.decay ?? 0).toFixed(2)}s` },
    { id: 'tone', label: 'SNAP', x: 0.8, y: 0.45, size: 0.13, value: params.tone, valueDisplay: `${Math.round(params.tone * 100)}%` },
    { id: 'volume', label: 'LEVEL', x: 0.9, y: 0.8, size: 0.08, value: params.volume, valueDisplay: `${Math.round(params.volume * 100)}%` },
];

export const getSnareControls = (params: SnareParams): KnobConfig[] => [
    { id: 'tone', label: 'TUNE', x: 0.25, y: 0.45, size: 0.13, value: (params.tone - 100) / 300, valueDisplay: `${Math.round(params.tone)}Hz` },
    { id: 'noise', label: 'SNAPPY', x: 0.5, y: 0.45, size: 0.13, value: (params.noise - 1000) / 7000, valueDisplay: `${Math.round(params.noise)}Hz` },
    { id: 'decay', label: 'DECAY', x: 0.75, y: 0.45, size: 0.11, value: (params.decay ?? 0) * 2, valueDisplay: `${(params.decay ?? 0).toFixed(2)}s` },
    { id: 'volume', label: 'LEVEL', x: 0.9, y: 0.8, size: 0.08, value: params.volume, valueDisplay: `${Math.round(params.volume * 100)}%` },
];

export const getClosedHatControls = (params: HatParams): KnobConfig[] => [
    { id: 'decay', label: 'DECAY', x: 0.3, y: 0.45, size: 0.13, value: (params.decay ?? 0), valueDisplay: `${(params.decay ?? 0).toFixed(2)}s` },
    { id: 'pitch', label: 'TONE', x: 0.6, y: 0.45, size: 0.13, value: params.pitch / 12000, valueDisplay: `${(params.pitch / 1000).toFixed(1)}kHz` },
    { id: 'volume', label: 'LEVEL', x: 0.9, y: 0.8, size: 0.08, value: params.volume, valueDisplay: `${Math.round(params.volume * 100)}%` },
];

export const getOpenHatControls = (params: HatParams): KnobConfig[] => [
    { id: 'decay', label: 'DECAY', x: 0.3, y: 0.45, size: 0.13, value: (params.decay ?? 0), valueDisplay: `${(params.decay ?? 0).toFixed(2)}s` },
    { id: 'pitch', label: 'TONE', x: 0.6, y: 0.45, size: 0.13, value: params.pitch / 12000, valueDisplay: `${(params.pitch / 1000).toFixed(1)}kHz` },
    { id: 'volume', label: 'LEVEL', x: 0.9, y: 0.8, size: 0.08, value: params.volume, valueDisplay: `${Math.round(params.volume * 100)}%` },
];

export const getSamplerControls = (params: SamplerBankParams): KnobConfig[] => [
    { id: 'volume', label: 'LEVEL', x: 0.8, y: 0.25, size: 0.1, value: params.volume, valueDisplay: `${Math.round(params.volume * 100)}%` },
    { id: 'playbackSpeed', label: 'SPEED', x: 0.2, y: 0.25, size: 0.1, value: (params.playbackSpeed) / 4.0, valueDisplay: `${params.playbackSpeed.toFixed(2)}x` },
    { id: 'filterCutoff', label: 'CUTOFF', x: 0.2, y: 0.65, size: 0.12, value: params.filterCutoff / 20000, valueDisplay: `${Math.round(params.filterCutoff)}Hz` },
    { id: 'filterResonance', label: 'RES', x: 0.4, y: 0.65, size: 0.12, value: params.filterResonance / 20, valueDisplay: `${params.filterResonance.toFixed(1)}` },
    { id: 'drive', label: 'DRIVE', x: 0.6, y: 0.65, size: 0.12, value: params.drive, valueDisplay: `${Math.round(params.drive * 100)}%` },
    { id: 'delaySend', label: 'DELAY', x: 0.8, y: 0.65, size: 0.12, value: params.delaySend, valueDisplay: `${Math.round(params.delaySend * 100)}%` },
    { id: 'glitchChance', label: 'GLITCH', x: 0.5, y: 0.85, size: 0.08, value: params.glitchChance || 0, valueDisplay: `${Math.round((params.glitchChance || 0) * 100)}%` },
];
