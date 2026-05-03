import React, { useCallback, useEffect, useRef, useState, useMemo, lazy, Suspense, memo } from 'react';

import { useAudioEngine } from './hooks/useAudioEngine';
import { usePyodideEngine } from './hooks/usePyodideEngine';
import { useScheduler } from './hooks/useScheduler';
import { useStepHandler } from './hooks/useStepHandler';
import { useGamepad } from './hooks/useGamepad';
import { useStableKnobConfig } from './hooks/useStableKnobConfig';
import { useSongStorage } from './hooks/useSongStorage';
import { useTTSPreloader } from './hooks/useTTSPreloader';
import { GamepadDebugger } from './components/GamepadDebugger';
import { HardwareModule } from './components/HardwareModule';
import { SamplerVoicePanel } from './components/SamplerVoicePanel';
import { WaveformSelector } from './components/WaveformSelector';
import { NoteSelector } from './components/NoteSelector';
import { ScaleSelector } from './components/ScaleSelector';
import { LiveKeyboard } from './components/LiveKeyboard';
import { LyricTrack } from './components/LyricTrack';
import { ShortcutsHelp } from './components/ShortcutsHelp';
import { VoiceEditor } from './components/VoiceEditor';
import { SamplerPanel } from './components/SamplerPanel';
import { SongMode } from './components/SongMode';
import { CloudLibrary } from './components/CloudLibrary';
import { AISongModal } from './components/AISongModal';
import { RbsImportModal } from './components/RbsImportModal';
import { CloudStatus } from './components/CloudStatus';
import { Toast } from './components/Toast';
import { SupertonicService } from './services/Supertonic';
import { loadingProgressStore } from './stores/loadingProgressStore';
import { exportSongToXM } from './utils/xmExport';
import { getNoteColor } from './utils/noteColors';
import { noteToMidi, midiToNote } from './utils/musicTheory';
import type { ScaleDefinition } from './utils/musicTheory';
import { copySteps, pasteSteps } from './utils/clipboardUtils';
import { MainSequencer, ROWS } from './components/MainSequencer';
import type { MainSequencerHandle } from './components/MainSequencer';
import type { AlignmentResult } from './engines/rubberband/PhonemeAligner';
import { SEQUENCER_STYLES } from './components/sequencer/constants';
import { type HarmonizerConfig } from './engines/Harmonizer';

const Studio3D = lazy(() => import('./components/Studio3D').then(module => ({ default: module.Studio3D })));

import {
    NUM_STEPS,
    DEFAULT_TEMPO,
    DEFAULT_SYNTH_PARAMS_A,
    DEFAULT_SYNTH_PARAMS_B,
    DEFAULT_BASS2_PARAMS,
    DEFAULT_KICK_PARAMS,
    DEFAULT_SNARE_PARAMS,
    DEFAULT_CLOSED_HAT_PARAMS,
    DEFAULT_OPEN_HAT_PARAMS,
} from './constants';
import type { Pattern, SynthParams, KickParams, SnareParams, SamplerParams, SamplerBankParams, PartSequence, Note, Bass2Params, PhonemeData, ReverbType } from './types';
import {
    INITIAL_SAMPLER_PARAMS, UPDATED_INITIAL_PATTERN,
    type TrackKey, type SongSnapshot,
    getInitialTrackStorage,
    COLOR_LEAD, COLOR_BASS, COLOR_BASS2, COLOR_KICK, COLOR_SNARE, COLOR_CH, COLOR_OH, COLOR_SAMPLER,
} from './constants/appDefaults';
import {
    getBass2Controls, getSynthControls, getKickControls, getSnareControls,
    getClosedHatControls, getOpenHatControls, getSamplerControls,
} from './utils/knobConfigs';
import { StartOverlay } from './components/StartOverlay';

// ---------------------------------------------------------------------------
// Rack Container — memoized with custom comparison so that control changes
// on a hidden track do not force the entire rack subtree to re-render.
// ---------------------------------------------------------------------------
interface RackProps {
    is3DMode: boolean;
    selectedTrack: TrackKey;
    onSelectTrack: (track: TrackKey) => void;
    modules: Record<TrackKey, React.ReactNode>;
}

const Rack = memo(({ is3DMode, selectedTrack, onSelectTrack, modules }: RackProps) => {
    return (
        <div className="w-full h-full bg-gradient-to-br from-black to-[#0a0c0f] rounded-2xl border-2 border-gray-700 overflow-hidden relative flex flex-col">
            <div className="absolute inset-0 rounded-2xl border-2 border-cyan-900/10 pointer-events-none"></div>

            {is3DMode && (
                <div className="flex items-center justify-center gap-2 p-2 bg-[#050709] border-b border-gray-800 shrink-0 z-50 relative pointer-events-auto">
                    {ROWS.map((row: any) => (
                        <button
                            key={row.key}
                            onClick={() => onSelectTrack(row.key as TrackKey)}
                            className={`px-4 py-2 rounded text-xs font-bold font-orbitron border transition-all ${
                                selectedTrack === row.key 
                                    ? 'bg-cyan-900/50 text-cyan-400 border-cyan-500 shadow-[0_0_10px_cyan]' 
                                    : 'bg-gray-800 text-gray-500 border-gray-700 hover:bg-gray-700 hover:text-gray-300'
                            }`}
                        >
                            {row.label.toUpperCase()}
                        </button>
                    ))}
                </div>
            )}

            <div className="flex-1 relative overflow-hidden">
                {modules[selectedTrack]}
            </div>

            {/* Screw details */}
            <div className="absolute top-2 left-2 w-3 h-3 rounded-full bg-gray-800 flex items-center justify-center border border-gray-600">
                <div className="w-1.5 h-[1px] bg-gray-600 rotate-45"></div>
            </div>
            <div className="absolute top-2 right-2 w-3 h-3 rounded-full bg-gray-800 flex items-center justify-center border border-gray-600">
                <div className="w-1.5 h-[1px] bg-gray-600 rotate-45"></div>
            </div>
            <div className="absolute bottom-2 left-2 w-3 h-3 rounded-full bg-gray-800 flex items-center justify-center border border-gray-600">
                <div className="w-1.5 h-[1px] bg-gray-600 rotate-45"></div>
            </div>
            <div className="absolute bottom-2 right-2 w-3 h-3 rounded-full bg-gray-800 flex items-center justify-center border border-gray-600">
                <div className="w-1.5 h-[1px] bg-gray-600 rotate-45"></div>
            </div>
        </div>
    );
}, (prev, next) => {
    if (prev.is3DMode !== next.is3DMode) return false;
    if (prev.selectedTrack !== next.selectedTrack) return false;
    if (prev.onSelectTrack !== next.onSelectTrack) return false;
    return prev.modules[prev.selectedTrack] === next.modules[next.selectedTrack];
});

export const App: React.FC = () => {
    // ... (all your state, hooks, handlers remain exactly the same until the memoized nodes)

    // Memoize each rack module independently
    const rackModulePartA = useMemo(() => 
        <HardwareModule title="SYNTH A // LEAD" colorHex={COLOR_LEAD} controls={synthAControls} onParamChange={onSynthAParamChange} is3D={is3DMode}>
            {synthAChild}
        </HardwareModule>, 
        [synthAControls, onSynthAParamChange, is3DMode, synthAChild]
    );

    const rackModulePartB = useMemo(() => 
        <HardwareModule title="SYNTH B // BASS" colorHex={COLOR_BASS} controls={synthBControls} onParamChange={onSynthBParamChange} is3D={is3DMode}>
            {synthBChild}
        </HardwareModule>, 
        [synthBControls, onSynthBParamChange, is3DMode, synthBChild]
    );

    const rackModuleBass2 = useMemo(() => 
        <HardwareModule title="BASS 2 // TB-303" colorHex={COLOR_BASS2} controls={bass2Controls} onParamChange={onBass2ParamChange} is3D={is3DMode}>
            {bass2Child}
        </HardwareModule>, 
        [bass2Controls, onBass2ParamChange, is3DMode, bass2Child]
    );

    const rackModuleKick = useMemo(() => 
        <HardwareModule title="KICK DRUM" colorHex={COLOR_KICK} controls={kickControls} onParamChange={handleKickChange} is3D={is3DMode} />, 
        [kickControls, handleKickChange, is3DMode]
    );

    const rackModuleSnare = useMemo(() => 
        <HardwareModule title="SNARE DRUM" colorHex={COLOR_SNARE} controls={snareControls} onParamChange={handleSnareChange} is3D={is3DMode} />, 
        [snareControls, handleSnareChange, is3DMode]
    );

    const rackModuleClosedHat = useMemo(() => 
        <HardwareModule title="CLOSED HAT" colorHex={COLOR_CH} controls={closedHatControls} onParamChange={handleClosedHatChange} is3D={is3DMode} />, 
        [closedHatControls, handleClosedHatChange, is3DMode]
    );

    const rackModuleOpenHat = useMemo(() => 
        <HardwareModule title="OPEN HAT" colorHex={COLOR_OH} controls={openHatControls} onParamChange={handleOpenHatChange} is3D={is3DMode} />, 
        [openHatControls, handleOpenHatChange, is3DMode]
    );

    const rackModuleSampler = useMemo(() => (
        <SamplerVoicePanel
            title={`SAMPLER // BANK ${activeSamplerBank + 1}`}
            colorHex={COLOR_SAMPLER}
            controls={samplerControls}
            onParamChange={handleSamplerChange}
            is3D={is3DMode}
            {...samplerVoiceParams}
            onSamplerParamChange={handleSamplerVoiceChange}
            harmonizerConfig={harmonizerConfig}
            onHarmonizerConfigChange={handleHarmonizerConfigChange}
            isHarmonizeActive={isHarmonizeActive}
        >
            {samplerChild}
        </SamplerVoicePanel>
    ), [activeSamplerBank, samplerControls, handleSamplerChange, is3DMode, samplerVoiceParams, handleSamplerVoiceChange, harmonizerConfig, handleHarmonizerConfigChange, isHarmonizeActive, samplerChild]);

    const rackModules = useMemo(() => ({
        partA: rackModulePartA,
        partB: rackModulePartB,
        bass2: rackModuleBass2,
        kick: rackModuleKick,
        snare: rackModuleSnare,
        closedHat: rackModuleClosedHat,
        openHat: rackModuleOpenHat,
        sampler: rackModuleSampler,
    }), [rackModulePartA, rackModulePartB, rackModuleBass2, rackModuleKick, rackModuleSnare, rackModuleClosedHat, rackModuleOpenHat, rackModuleSampler]);

    const rackNode = <Rack is3DMode={is3DMode} selectedTrack={selectedTrack} onSelectTrack={setSelectedTrack} modules={rackModules} />;

    // ... rest of your code (transportToolbarNode, sequencerNode, contextMenuNode, keyboardNode, etc.) stays the same

    // In the 2D return, use {rackNode} as before
    // In the 3D Studio3D pass, also use {rackNode}

    return (
        <div className="flex flex-col h-screen w-screen ...">
            {/* ... all your existing JSX ... */}
            <div className="w-full max-w-[1000px] mx-auto shrink-0 mt-2 px-4">
                <div className="h-[380px] rounded-xl overflow-hidden shadow-[0_8px_32px_rgba(0,0,0,0.6)] border border-cyan-500/20">
                    {rackNode}
                </div>
            </div>
            {/* ... rest unchanged */}
        </div>
    );
};

export default App;