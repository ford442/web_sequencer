/**
 * The app's composition root: wires the state stores and handler sub-hooks
 * into one object. That object is a fresh reference on every render, so it
 * must never be handed to consumers directly: `AppStateProvider`
 * (src/contexts/AppStateContext.tsx) publishes it to an external store
 * (src/stores/appStateStore.ts) and components read it through
 * `useAppStateSlice(KEYS)` / `useAppStateSelector(fn)`, re-rendering only when
 * the fields they selected change. Function fields are published as stable
 * proxies to the latest closure, so selecting a handler never re-renders
 * anything.
 *
 * Rules for consumers:
 *   - Select the fields a component *renders*; do not destructure the whole
 *     state (`useAppStateContext()` is deprecated and follows every change).
 *   - A handler's identity no longer signals a changed closure. Derive values
 *     by calling the function inside a selector, not in a `useMemo` keyed on
 *     the function.
 *   - Values built here must be referentially stable when their contents are —
 *     a fresh array/object each render invalidates every selector and
 *     `useMemo` downstream (see `useStableFlags` in useHardwarePanels.tsx).
 *   - `src/__tests__/appRenderBudget.test.tsx` gates this: a pattern edit may
 *     re-render `SequencerGrid` only.
 *
 * The song's data lives in `useSyncExternalStore` stores under src/stores/
 * (pattern, instrument patches, sampler banks, transport/mix, arrangement,
 * session, automation, note FX), each bound to the project doc (#1597 P2,
 * src/collab/appBindings.ts): the doc is the source of truth, undo and
 * collaboration go through it. The `src/hooks/appState/use*State.ts` wrappers
 * keep this function returning the same field names; a component that needs
 * one value can subscribe to its store directly, which skips the provider.
 */
import { useMemo, useRef, useState } from 'react'
import { useAudioEngine } from './useAudioEngine'
import { usePyodideEngine } from './usePyodideEngine'
import { useRequestPythonForWaveforms } from './useRequestPythonForWaveforms'
import { useScheduler } from './useScheduler'
import { useStepHandler } from './useStepHandler'
import { useGamepad } from './useGamepad'
import { useMidi } from './useMidi'
import { useTransportSyncStore } from '../stores/transportSyncStore'
import { useStableKnobConfig } from './useStableKnobConfig'
import { useSongStorage } from './useSongStorage'
import { useProjectAutosave } from './useProjectAutosave'
import { useTTSPreloader } from './useTTSPreloader'
import type { MainSequencerHandle } from '../components/MainSequencer'
import { swingPercentToClock } from '../utils/musicTheory'
import type { ResolvedTrakEvent } from '../types'
import {
    getBass2Controls, getSynthControls, getKickControls, getSnareControls,
    getClosedHatControls, getOpenHatControls, getSamplerControls,
} from '../utils/knobConfigs'
import { patternStore, usePatternStore } from '../stores/patternStore'
import { useSelectionHandlers } from './appState/useSelectionHandlers'
import { useClipboardHandlers } from './appState/useClipboardHandlers'
import { usePatternHandlers } from './appState/usePatternHandlers'
import { useAutomationHandlers } from './appState/useAutomationHandlers'
import { useKeyboardHandlers } from './appState/useKeyboardHandlers'
import { useLyricHandlers } from './appState/useLyricHandlers'
import { useSynthParamHandlers } from './appState/useSynthParamHandlers'
import { useMasterHandlers } from './appState/useMasterHandlers'
import { useTransportHandlers } from './appState/useTransportHandlers'
import { useAutoMix } from './appState/useAutoMix'
import { useSongHandlers, useSampleHandlers } from './appState/useSongHandlers'
import { useHardwarePanels } from './appState/useHardwarePanels'
import { useInstrumentState } from './appState/useInstrumentState'
import { useSamplerVoiceState } from './appState/useSamplerVoiceState'
import { useUIModalsState } from './appState/useUIModalsState'
import { useSongModeState } from './appState/useSongModeState'
import { useSessionState } from './appState/useSessionState'
import { useSessionPacks } from './appState/useSessionPacks'
import { usePatternEditState } from './appState/usePatternEditState'
import { useSamplerBanksState } from './appState/useSamplerBanksState'
import { useTransportMixState } from './appState/useTransportMixState'
import { useEngineParamSync } from './appState/useEngineParamSync'
import { useTransportLifecycle } from './appState/useTransportLifecycle'
import { useBootSequence } from './appState/useBootSequence'
import { recallTrackParamSlot } from './appState/trackSlotRecall'

export function useAppState() {
    const { pyodide } = usePyodideEngine()
    const ui = useUIModalsState()
    const { showToast } = ui
    useGamepad()

    const mix = useTransportMixState()
    const { tempo, tempoRef } = mix

    const { audioEngine, isReady, initializeAudio, onParamChange, drumKitEngineRef, prophecyManagerRef, macroManagerRef } = useAudioEngine(pyodide, tempo)
    // Core sequencer transport only needs the Web Audio engine — it never touches
    // Pyodide ("Spectral Puppet"), so gating playback on Python readiness left the
    // clock permanently blocked whenever Pyodide was slow or failed to load.
    const isEngineReady = isReady

    useTTSPreloader()

    const [viewMode, setViewMode] = useState<'notes' | 'automation'>('notes')
    const [automationParam, setAutomationParam] = useState('formantShift')
    const [melodicMode, setMelodicMode] = useState(false)

    const banks = useSamplerBanksState(audioEngine)
    const { trackStorageRef, activeTrackSlotsRef, activeSamplerBank, activeSamplerBankRef, ttsPhrases } = banks

    const boot = useBootSequence({ initializeAudio, setHasStarted: ui.setHasStarted })

    // The live pattern is a store bound to the project doc; its ref is always current.
    const pattern = usePatternStore()
    const setPattern = patternStore.set
    const patternRef = patternStore.ref
    const [isPlaying, setIsPlaying] = useState(false)
    const [isRecording, setIsRecording] = useState(false)
    const [isAutomationRecording, setIsAutomationRecording] = useState(false)

    const edit = usePatternEditState()
    const song = useSongModeState()
    const { rbsArrangementExtrasRef, isSongModeActive, setIsSongModeActive } = song
    const session = useSessionState()
    const inst = useInstrumentState(drumKitEngineRef)
    const { synthA, synthB, bass2, synthARef, synthBRef, bass2Ref, kickRef, snareRef, closedHatRef, openHatRef, samplerRef } = inst
    // Python loads only for a part that actually selects a pyodide-* waveform or the Pyodide filter.
    useRequestPythonForWaveforms(
        [synthA.waveform, synthB.waveform],
        [synthA.filterSource, synthB.filterSource],
    )

    const automationSchedulerRef = useEngineParamSync({
        audioEngine, isReady, synthA, synthB, bass2, macroManagerRef, prophecyManagerRef,
    })

    const sequencerRef = useRef<MainSequencerHandle>(null)
    const currentStepRef = useRef(-1)
    const trakEventsRef = useRef<ResolvedTrakEvent[] | null>(null)
    const activeKeyboardNotesRef = useRef<Map<string, number>>(new Map())

    const voice = useSamplerVoiceState({
        audioEngine, sampler: inst.sampler, activeSamplerBank, activeSamplerBankRef,
        samplerRef, setSampler: inst.setSampler, currentStepRef,
    })

    const patternHandlers = usePatternHandlers({
        patternRef, setPattern, activeSamplerBankRef,
        contextMenu: edit.contextMenu, setContextMenu: edit.setContextMenu, setSelection: edit.setSelection,
        trackStorageRef, activeTrackSlotsRef, setTrackStorage: banks.setTrackStorage, setActiveTrackSlots: banks.setActiveTrackSlots,
        setSelectedTrack: edit.setSelectedTrack,
        onTrackSlotRecall: (track, slotIndex) =>
            recallTrackParamSlot(track, slotIndex, audioEngine, rbsArrangementExtrasRef.current?.trackParamStorage),
    })
    const { updateStorageForTrack } = patternHandlers

    const selectionHandlers = useSelectionHandlers(edit.selection, edit.isSelecting, edit.setSelection, edit.setIsSelecting)

    const clipboardHandlers = useClipboardHandlers({
        selection: edit.selection, selectedTrack: edit.selectedTrack, clipboard: edit.clipboard,
        setClipboard: edit.setClipboard, setPattern, setSelection: edit.setSelection,
        patternRef, activeSamplerBankRef, updateStorageForTrack, showToast,
        handleSelectionEnd: selectionHandlers.handleSelectionEnd, audioEngine,
    })

    const { onStep } = useStepHandler({
        audioEngine, tempo, onParamChange, currentStepRef, sequencerRef, patternRef,
        lastFreqRef: mix.lastFreqRef,
        lastSamplerMidiRef: banks.lastSamplerMidiRef,
        lastSamplerFormantRef: banks.lastSamplerFormantRef,
        synthARef, synthBRef, bass2Ref, kickRef, snareRef, closedHatRef, openHatRef, samplerRef,
        samplerVoiceParamsRef: voice.samplerVoiceParamsRef,
        activeSamplerBankRef,
        sliceHighlightRef: banks.sliceHighlightRef,
        isSongModeActiveRef: song.isSongModeActiveRef,
        arrangementRef: song.arrangementRef,
        currentScaleRef: edit.currentScaleRef,
        songMeasureRef: song.songMeasureRef,
        isFirstStepRef: song.isFirstStepRef,
        trackStorageRef,
        setCurrentSongMeasure: song.setCurrentSongMeasure,
        automationSchedulerRef, trakEventsRef, rbsArrangementExtrasRef,
        setSynthA: inst.setSynthA, setSynthB: inst.setSynthB, setBass2: inst.setBass2,
        sessionEngineRef: session.sessionEngineRef,
        sessionClockRef: session.sessionClockRef,
        setIsSongModeActive,
        onSessionTick: session.setPlayingSlots,
    })

    const { isPlaying: schedPlaying, setIsPlaying: setSchedPlaying } = useScheduler(tempo, mix.stepCount, onStep, isEngineReady, audioEngine?.context ?? null, swingPercentToClock(mix.swing))

    useTransportLifecycle({
        schedPlaying, tempo, audioEngine, setIsPlaying,
        setCurrentSongMeasure: song.setCurrentSongMeasure,
        songMeasureRef: song.songMeasureRef,
        isFirstStepRef: song.isFirstStepRef,
        sequencerRef, currentStepRef, automationSchedulerRef,
        sessionClockRef: session.sessionClockRef,
        sessionEngineRef: session.sessionEngineRef,
    })

    const transport = useTransportHandlers({
        isInitialized: boot.isInitialized, isReady, initializeAudio, setIsInitialized: boot.setIsInitialized,
        audioEngine, setSchedPlaying, setTempo: mix.setTempo,
        activeKeyboardNotesRef,
    })

    const automationHandlers = useAutomationHandlers({
        automationParam, patternRef, setPattern, activeSamplerBankRef,
        updateStorageForTrack, currentStepRef, schedPlaying,
        isAutomationRecording, isSongModeActive, activeTrackSlotsRef, isSongModeActiveRef: song.isSongModeActiveRef,
    })

    const masterHandlers = useMasterHandlers({
        setMasterVolume: mix.setMasterVolume, setMasterSaturation: mix.setMasterSaturation,
        setGlobalPan: mix.setGlobalPan, setReverbType: mix.setReverbType,
        audioEngine, currentStepRef,
    })

    const synthHandlers = useSynthParamHandlers({
        updateSynthA: inst.updateSynthA, updateSynthB: inst.updateSynthB, updateBass2: inst.updateBass2,
        updateKick: inst.updateKick, updateSnare: inst.updateSnare,
        updateClosedHat: inst.updateClosedHat, updateOpenHat: inst.updateOpenHat, setSampler: inst.setSampler,
        activeSamplerBank, currentStepRef, samplerRef,
    })

    const midiHandlers = useMemo(
        () => ({
            handleSynthChange: synthHandlers.handleSynthChange,
            handleBass2Change: synthHandlers.handleBass2Change,
            handleKickChange: synthHandlers.handleKickChange,
            handleSnareChange: synthHandlers.handleSnareChange,
            handleClosedHatChange: synthHandlers.handleClosedHatChange,
            handleOpenHatChange: synthHandlers.handleOpenHatChange,
            handleSamplerChange: synthHandlers.handleSamplerChange,
            setMasterVolume: mix.setMasterVolume,
            setMasterSaturation: mix.setMasterSaturation,
            setGlobalPan: mix.setGlobalPan,
            setAudioMasterVolume: (v: number) => audioEngine?.setMasterVolume?.(v),
            setAudioMasterSaturation: (v: number) => audioEngine?.setMasterSaturation?.(v),
            setAudioGlobalPan: (v: number) => audioEngine?.setGlobalPan?.(v),
            getCurrentStep: () => currentStepRef.current,
            handleSessionControl: session.handleSessionMidi,
        }),
        [
            synthHandlers.handleSynthChange, synthHandlers.handleBass2Change, synthHandlers.handleKickChange,
            synthHandlers.handleSnareChange, synthHandlers.handleClosedHatChange, synthHandlers.handleOpenHatChange,
            synthHandlers.handleSamplerChange, mix.setMasterVolume, mix.setMasterSaturation, mix.setGlobalPan,
            audioEngine, session.handleSessionMidi,
        ],
    )
    useMidi({ handlers: midiHandlers, showToast })

    const { mode: transportSyncMode } = useTransportSyncStore()
    const tempoLocked = transportSyncMode === 'slave'
    const slavePlayLabel = transportSyncMode === 'slave'
        ? (schedPlaying ? '■ UNARM' : '◎ ARM')
        : undefined

    const sampleHandlers = useSampleHandlers({
        audioEngine, activeSamplerBank, ttsPhrases,
        setSampleBuffers: banks.setSampleBuffers, setSampler: inst.setSampler, setActiveAlignment: banks.setActiveAlignment,
    })

    const lyricHandlers = useLyricHandlers({
        audioEngine, patternRef, tempoRef, activeSamplerBankRef, samplerRef,
        setPattern, setSampler: inst.setSampler, setTtsPhrases: banks.setTtsPhrases,
        setIsGenerating: ui.setIsGenerating, setIsLyricTrackVisible: ui.setIsLyricTrackVisible,
        ttsPhrases, activeSamplerBank, handleLoadSample: sampleHandlers.handleLoadSample, updateStorageForTrack, showToast,
        setActiveAlignment: banks.setActiveAlignment, currentScale: edit.currentScale, setCurrentScale: edit.setCurrentScale,
    })

    const keyboardHandlers = useKeyboardHandlers({
        audioEngine, selectedTrack: edit.selectedTrack, isRecording, isPlaying,
        isNoteDragging: edit.isNoteDragging, isDrawing: edit.isDrawing,
        activeSamplerBank, setPattern, setIsNoteDragging: edit.setIsNoteDragging, setIsDrawing: edit.setIsDrawing,
        setDrawMode: edit.setDrawMode, setContextMenu: edit.setContextMenu,
        patternRef, activeSamplerBankRef, currentStepRef,
        synthARef, synthBRef, bass2Ref, kickRef, snareRef, closedHatRef, openHatRef,
        samplerRef, samplerVoiceParamsRef: voice.samplerVoiceParamsRef, activeKeyboardNotesRef, noteDragRef: edit.noteDragRef,
        updateStorageForTrack,
    })

    const autoMix = useAutoMix({
        patternRef, updateSynthA: inst.updateSynthA, updateSynthB: inst.updateSynthB, updateBass2: inst.updateBass2,
        updateKick: inst.updateKick, updateSnare: inst.updateSnare,
        updateClosedHat: inst.updateClosedHat, updateOpenHat: inst.updateOpenHat, setSampler: inst.setSampler,
        setMasterVolume: mix.setMasterVolume, audioEngine,
        synthA, synthB,
    })

    const songHandlers = useSongHandlers({
        songStructure: song.songStructure, setSongStructure: song.setSongStructure, setIsSongModeOpen: song.setIsSongModeOpen,
        patternRef, songStructureRef: song.songStructureRef, arrangementRef: song.arrangementRef, trackStorageRef, tempoRef,
        synthARef, synthBRef, bass2Ref, kickRef, snareRef, closedHatRef, openHatRef, samplerRef,
        audioEngine, pyodide, sampleBuffers: banks.sampleBuffers, showToast,
    })

    const storage = useSongStorage({
        audioEngine, showToast,
        setIsAISongModalOpen: ui.setIsAISongModalOpen,
        setIsRbsImportModalOpen: ui.setIsRbsImportModalOpen,
        setIsSmfImportModalOpen: ui.setIsSmfImportModalOpen,
        setDrumKit: inst.updateDrumKit,
        setIsSongModeActive,
        isSongModeActive,
        rbsArrangementExtrasRef,
        trakEventsRef,
    })

    const autosave = useProjectAutosave({ getSongData: storage.getSongData, isInitialized: boot.isInitialized })

    const panels = useHardwarePanels({
        synthA, synthB, bass2, sampler: inst.sampler,
        updateSynthA: inst.updateSynthA, updateSynthB: inst.updateSynthB, updateBass2: inst.updateBass2, updateSampler: inst.updateSampler,
        audioEngine,
        isVoiceEditorOpen: ui.isVoiceEditorOpen, setIsVoiceEditorOpen: ui.setIsVoiceEditorOpen,
        handleTtsPhraseChange: lyricHandlers.handleTtsPhraseChange, handleGenerateTTS: lyricHandlers.handleGenerateTTS,
        handleSamplerParamChange: synthHandlers.handleSamplerParamChange, handleLoadSample: sampleHandlers.handleLoadSample,
        melodicMode, setMelodicMode,
        handleHarmonizerConfigChange: voice.handleHarmonizerConfigChange,
    })

    const synthAControls = useStableKnobConfig(getSynthControls, synthA)
    const synthBControls = useStableKnobConfig(getSynthControls, synthB)
    const bass2Controls = useStableKnobConfig(getBass2Controls, bass2)
    const kickControls = useStableKnobConfig(getKickControls, inst.kick)
    const snareControls = useStableKnobConfig(getSnareControls, inst.snare)
    const closedHatControls = useStableKnobConfig(getClosedHatControls, inst.closedHat)
    const openHatControls = useStableKnobConfig(getOpenHatControls, inst.openHat)
    const samplerControls = useStableKnobConfig(getSamplerControls, inst.sampler[activeSamplerBank])

    // Session pack import / export (previews first; loads only on an explicit confirm).
    const sessionPackFiles = useSessionPacks({
        sessionDocumentRef: session.sessionDocumentRef,
        setSessionDocument: session.setSessionDocument,
        trackStorageRef,
        setTrackStorage: banks.setTrackStorage,
        synthARef,
        synthBRef,
        updateSynthA: inst.updateSynthA,
        updateSynthB: inst.updateSynthB,
    })

    return {
        ...ui,
        ...mix,
        ...banks,
        ...edit,
        ...song,
        ...inst,
        ...voice,
        ...boot,
        ...autosave,
        ...patternHandlers,
        ...selectionHandlers,
        ...clipboardHandlers,
        ...transport,
        ...automationHandlers,
        ...masterHandlers,
        ...synthHandlers,
        ...sampleHandlers,
        ...lyricHandlers,
        ...keyboardHandlers,
        ...autoMix,
        ...songHandlers,
        ...storage,
        ...panels,
        pyodide,
        audioEngine, isReady, initializeAudio, onParamChange,
        isEngineReady,
        pattern, setPattern, patternRef,
        currentStepRef, sequencerRef, activeKeyboardNotesRef,
        isPlaying, setIsPlaying,
        isRecording, setIsRecording,
        isAutomationRecording, setIsAutomationRecording,
        viewMode, setViewMode,
        automationParam, setAutomationParam,
        melodicMode, setMelodicMode,
        handleEditSongStructure: song.editSongStructure,
        synthAControls, synthBControls, bass2Controls, kickControls,
        snareControls, closedHatControls, openHatControls, samplerControls,
        tempoLocked,
        slavePlayLabel,
        isSessionOpen: session.isSessionOpen,
        setIsSessionOpen: session.setIsSessionOpen,
        sessionDocument: session.sessionDocument,
        setSessionDocument: session.setSessionDocument,
        sessionPlayingSlots: session.playingSlots,
        isSessionCapturing: session.isCapturing,
        launchSessionClip: session.launchClip,
        launchSessionScene: session.launchScene,
        stopSessionTrack: session.stopTrack,
        stopSessionAll: session.stopAll,
        setSessionQuantization: session.setQuantization,
        beginSessionCapture: session.beginCapture,
        finishSessionCapture: session.finishCapture,
        sessionPackFiles,
        loadSessionPack: (id: string) => session.loadPack(id, banks.setTrackStorage, { synthA: inst.updateSynthA, synthB: inst.updateSynthB }),
    }
}
