import { useCallback } from 'react'
import { uiModalsStore, useUIModalsStore } from '../../stores/uiModalsStore'

/**
 * Compatibility wrapper around `uiModalsStore` — preserves the field shape
 * `useAppState()` (and everything that reads modal flags off
 * `useAppStateContext()`) already expects, while the store itself lets new
 * consumers subscribe to a single flag directly via `useUIModalsStore(selector)`.
 */
export function useUIModalsState() {
    const state = useUIModalsStore();

    const showToast = useCallback((message: string, type: 'success' | 'error' | 'info' = 'success') => {
        uiModalsStore.showToast(message, type);
    }, []);

    return {
        isVoiceEditorOpen: state.isVoiceEditorOpen, setIsVoiceEditorOpen: uiModalsStore.setIsVoiceEditorOpen,
        isCloudLibraryOpen: state.isCloudLibraryOpen, setIsCloudLibraryOpen: uiModalsStore.setIsCloudLibraryOpen,
        isAISongModalOpen: state.isAISongModalOpen, setIsAISongModalOpen: uiModalsStore.setIsAISongModalOpen,
        isRbsImportModalOpen: state.isRbsImportModalOpen, setIsRbsImportModalOpen: uiModalsStore.setIsRbsImportModalOpen,
        isExportModalOpen: state.isExportModalOpen, setIsExportModalOpen: uiModalsStore.setIsExportModalOpen,
        isLyricTrackVisible: state.isLyricTrackVisible, setIsLyricTrackVisible: uiModalsStore.setIsLyricTrackVisible,
        isShortcutsHelpOpen: state.isShortcutsHelpOpen, setIsShortcutsHelpOpen: uiModalsStore.setIsShortcutsHelpOpen,
        showGamepadDebug: state.showGamepadDebug, setShowGamepadDebug: uiModalsStore.setShowGamepadDebug,
        isGenerating: state.isGenerating, setIsGenerating: uiModalsStore.setIsGenerating,
        hasStarted: state.hasStarted, setHasStarted: uiModalsStore.setHasStarted,
        forceScriptProcessorFallback: state.forceScriptProcessorFallback, setForceScriptProcessorFallback: uiModalsStore.setForceScriptProcessorFallback,
        is3DMode: state.is3DMode, setIs3DMode: uiModalsStore.setIs3DMode,
        toast: state.toast, setToast: uiModalsStore.setToast,
        showToast,
    }
}
