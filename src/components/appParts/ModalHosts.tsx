import React, { lazy, Suspense } from 'react'
import { useAppStateSlice } from '../../contexts/AppStateContext'
import { useUIModalsStore, uiModalsStore } from '@/stores/uiModalsStore'
import { helpDiscoveryStore, useHelpDiscoveryStore } from '../../stores/helpDiscoveryStore'
import { midiMapStore, useMidiMapStore } from '../../stores/midiMapStore'

// Route-split: none of these render on first paint — each is behind a modal
// toggle — so keep them out of the entry chunk and fetch on demand.
const CloudLibrary = lazy(() => import('../CloudLibrary').then(module => ({ default: module.CloudLibrary })));
const AISongModal = lazy(() => import('../AISongModal').then(module => ({ default: module.AISongModal })));
const RbsImportModal = lazy(() => import('../RbsImportModal').then(module => ({ default: module.RbsImportModal })));
const SmfImportModal = lazy(() => import('../SmfImportModal').then(module => ({ default: module.SmfImportModal })));
const ExportModal = lazy(() => import('../ExportModal').then(module => ({ default: module.ExportModal })));
const VoiceEditor = lazy(() => import('../VoiceEditor').then(module => ({ default: module.VoiceEditor })));
const ShortcutsHelp = lazy(() => import('../ShortcutsHelp').then(module => ({ default: module.ShortcutsHelp })));
const MidiMapPanel = lazy(() => import('../MidiMapPanel').then(module => ({ default: module.MidiMapPanel })));
const GamepadDebugger = lazy(() => import('../GamepadDebugger').then(module => ({ default: module.GamepadDebugger })));

/** Shared fallback for the small modal/panel Suspense boundaries below — the
 * dynamic import is typically already warm from a hover/click, so this is
 * rarely visible for more than a frame. */
const ModalLoadingFallback = () => (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
        <div className="font-mono text-xs uppercase tracking-widest text-cyan-400 animate-pulse">Loading…</div>
    </div>
);

/**
 * Every modal is a host/body pair. The host subscribes to nothing but its own
 * open flag, so a closed modal costs nothing on any app-state change; the body
 * mounts only while open and is the only place that subscribes to the state
 * the modal needs (a pattern edit, say, for the export dialog).
 */

const closeCloudLibrary = () => uiModalsStore.setIsCloudLibraryOpen(false)
const CLOUD_KEYS = ['loadCloudData', 'showToast', 'getSongData', 'getBankData', 'getPatternData'] as const

const CloudLibraryBody = () => {
    const { loadCloudData, showToast, getSongData, getBankData, getPatternData } = useAppStateSlice(CLOUD_KEYS)
    return <CloudLibrary isOpen onClose={closeCloudLibrary} onLoadData={(...args) => void loadCloudData(...args)} onShowToast={showToast} getSongData={getSongData} getBankData={getBankData} getPatternData={getPatternData} />
}
export const CloudLibraryHost = React.memo(() => {
    const isOpen = useUIModalsStore((s) => s.isCloudLibraryOpen)
    return isOpen ? <Suspense fallback={<ModalLoadingFallback />}><CloudLibraryBody /></Suspense> : null
})

const closeAISongModal = () => uiModalsStore.setIsAISongModalOpen(false)
const AI_MODAL_KEYS = ['handleAISongImport', 'showToast', 'isImportingAISong', 'audioEngine'] as const

const AISongModalBody = () => {
    const { handleAISongImport, showToast, isImportingAISong, audioEngine } = useAppStateSlice(AI_MODAL_KEYS)
    return <AISongModal isOpen onClose={closeAISongModal} onImport={(...args) => { void handleAISongImport(...args); }} onShowToast={showToast} isImporting={isImportingAISong} audioEngine={audioEngine} />
}
export const AISongModalHost = React.memo(() => {
    const isOpen = useUIModalsStore((s) => s.isAISongModalOpen)
    return isOpen ? <Suspense fallback={<ModalLoadingFallback />}><AISongModalBody /></Suspense> : null
})

const closeRbsImport = () => uiModalsStore.setIsRbsImportModalOpen(false)
const RBS_KEYS = ['handleRbsImport', 'showToast'] as const

const RbsImportModalBody = () => {
    const { handleRbsImport, showToast } = useAppStateSlice(RBS_KEYS)
    return <RbsImportModal isOpen onClose={closeRbsImport} onImport={(...args) => { void handleRbsImport(...args); }} onShowToast={showToast} />
}
export const RbsImportModalHost = React.memo(() => {
    const isOpen = useUIModalsStore((s) => s.isRbsImportModalOpen)
    return isOpen ? <Suspense fallback={<ModalLoadingFallback />}><RbsImportModalBody /></Suspense> : null
})

const closeSmfImport = () => uiModalsStore.setIsSmfImportModalOpen(false)
const SMF_KEYS = ['handleSmfImport', 'showToast'] as const

const SmfImportModalBody = () => {
    const { handleSmfImport, showToast } = useAppStateSlice(SMF_KEYS)
    return <SmfImportModal isOpen onClose={closeSmfImport} onImport={(...args) => { void handleSmfImport(...args); }} onShowToast={showToast} />
}
export const SmfImportModalHost = React.memo(() => {
    const isOpen = useUIModalsStore((s) => s.isSmfImportModalOpen)
    return isOpen ? <Suspense fallback={<ModalLoadingFallback />}><SmfImportModalBody /></Suspense> : null
})

const closeExportModal = () => uiModalsStore.setIsExportModalOpen(false)
const EXPORT_KEYS = [
    'showToast', 'songStructure', 'trackStorage', 'pattern', 'tempo',
    'synthA', 'synthB', 'bass2', 'kick', 'snare', 'closedHat', 'openHat', 'sampler',
    'audioEngine', 'pyodide', 'sampleBuffers', 'isHarmonizeActive',
] as const

const ExportModalBody = () => {
    const s = useAppStateSlice(EXPORT_KEYS)
    const { audioEngine } = s
    return (
        <ExportModal
            isOpen
            onClose={closeExportModal}
            onShowToast={s.showToast}
            songStructure={s.songStructure}
            trackStorage={s.trackStorage}
            currentPattern={s.pattern}
            tempo={s.tempo}
            params={{ synthA: s.synthA, synthB: s.synthB, bass2: s.bass2, kick: s.kick, snare: s.snare, closedHat: s.closedHat, openHat: s.openHat, sampler: s.sampler }}
            engines={{
                webGpuEngine: audioEngine?.webGpuEngine,
                wasmEngine: audioEngine?.wasmEngine,
                pyodide: s.pyodide,
            }}
            sampleBuffers={s.sampleBuffers}
            preferredSampleRate={audioEngine?.context?.sampleRate}
            harmonizerActive={s.isHarmonizeActive}
        />
    )
}
export const ExportModalHost = React.memo(() => {
    const isOpen = useUIModalsStore((s) => s.isExportModalOpen)
    return isOpen ? <Suspense fallback={<ModalLoadingFallback />}><ExportModalBody /></Suspense> : null
})

const closeVoiceEditor = () => uiModalsStore.setIsVoiceEditorOpen(false)
export const VoiceEditorHost = React.memo(() => {
    const isOpen = useUIModalsStore((s) => s.isVoiceEditorOpen)
    return isOpen ? <Suspense fallback={<ModalLoadingFallback />}><VoiceEditor onClose={closeVoiceEditor} /></Suspense> : null
})

const closeHelpModal = () => {
    uiModalsStore.setIsShortcutsHelpOpen(false)
    helpDiscoveryStore.closeHelp()
}
export const ShortcutsHelpHost = React.memo(() => {
    const isShortcutsHelpOpen = useUIModalsStore((s) => s.isShortcutsHelpOpen)
    const { helpOpen } = useHelpDiscoveryStore()
    return isShortcutsHelpOpen || helpOpen
        ? <Suspense fallback={<ModalLoadingFallback />}><ShortcutsHelp onClose={closeHelpModal} /></Suspense>
        : null
})

const closeGamepadDebug = () => uiModalsStore.setShowGamepadDebug(false)
export const GamepadDebugHost = React.memo(() => {
    const isOpen = useUIModalsStore((s) => s.showGamepadDebug)
    return isOpen ? <Suspense fallback={<ModalLoadingFallback />}><GamepadDebugger onClose={closeGamepadDebug} /></Suspense> : null
})

const closeMidiMapPanel = () => midiMapStore.setPanelOpen(false)
export const MidiMapHost = React.memo(() => {
    const { panelOpen } = useMidiMapStore()
    return panelOpen ? <Suspense fallback={<ModalLoadingFallback />}><MidiMapPanel onClose={closeMidiMapPanel} /></Suspense> : null
})

/** All of the app's lazy modals, in their original stacking order. */
export function ModalHosts() {
    return (
        <>
            <CloudLibraryHost />
            <AISongModalHost />
            <RbsImportModalHost />
            <SmfImportModalHost />
            <ExportModalHost />
            <VoiceEditorHost />
            <ShortcutsHelpHost />
            <GamepadDebugHost />
            <MidiMapHost />
        </>
    )
}
