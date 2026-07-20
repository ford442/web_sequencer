import { useCallback, useState } from 'react'

export function useUIModalsState() {
    const [isVoiceEditorOpen, setIsVoiceEditorOpen] = useState(false);
    const [isCloudLibraryOpen, setIsCloudLibraryOpen] = useState(false);
    const [isAISongModalOpen, setIsAISongModalOpen] = useState(false);
    const [isRbsImportModalOpen, setIsRbsImportModalOpen] = useState(false);
    const [isExportModalOpen, setIsExportModalOpen] = useState(false);
    const [isLyricTrackVisible, setIsLyricTrackVisible] = useState(false);
    const [isShortcutsHelpOpen, setIsShortcutsHelpOpen] = useState(false);
    const [showGamepadDebug, setShowGamepadDebug] = useState(false);
    const [isGenerating, setIsGenerating] = useState(false);
    const [hasStarted, setHasStarted] = useState(false);
    const [forceScriptProcessorFallback, setForceScriptProcessorFallback] = useState(() => {
        return localStorage.getItem('forceScriptProcessorFallback') === 'true';
    });
    const [is3DMode, setIs3DMode] = useState(false);

    const [toast, setToast] = useState<{ message: string, type: 'success' | 'error' | 'info' } | null>(null);
    const showToast = useCallback((message: string, type: 'success' | 'error' | 'info' = 'success') => {
        setToast({ message, type });
    }, []);

    return {
        isVoiceEditorOpen, setIsVoiceEditorOpen,
        isCloudLibraryOpen, setIsCloudLibraryOpen,
        isAISongModalOpen, setIsAISongModalOpen,
        isRbsImportModalOpen, setIsRbsImportModalOpen,
        isExportModalOpen, setIsExportModalOpen,
        isLyricTrackVisible, setIsLyricTrackVisible,
        isShortcutsHelpOpen, setIsShortcutsHelpOpen,
        showGamepadDebug, setShowGamepadDebug,
        isGenerating, setIsGenerating,
        hasStarted, setHasStarted,
        forceScriptProcessorFallback, setForceScriptProcessorFallback,
        is3DMode, setIs3DMode,
        toast, setToast,
        showToast,
    }
}
