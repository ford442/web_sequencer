import React, { useCallback } from 'react'
import { useAppStateSlice } from '../../contexts/AppStateContext'
import { Toast } from '../Toast'
import { CrashRecoveryPrompt } from '@/components/CrashRecoveryPrompt'
import { StartOverlay } from '../StartOverlay'
import { LoadingOverlay } from '../LoadingOverlay'
import { AISongImportOverlay } from '../AISongImportOverlay'

const TOAST_KEYS = ['toast', 'setToast'] as const

export const ToastNode = React.memo(() => {
    const { toast, setToast } = useAppStateSlice(TOAST_KEYS)
    if (!toast) return null
    return <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />
})

const RESTORE_KEYS = ['isInitialized', 'pendingRestore', 'restoreProject', 'dismissRestore', 'loadCloudData', 'showToast'] as const

export const CrashRecoveryNode = React.memo(() => {
    const { isInitialized, pendingRestore, restoreProject, dismissRestore, loadCloudData, showToast } = useAppStateSlice(RESTORE_KEYS)

    const handleRestoreProject = useCallback(async () => {
        const data = await restoreProject()
        if (data) {
            await loadCloudData(data, 'song')
            showToast('Restored previous session', 'success')
        }
    }, [restoreProject, loadCloudData, showToast])

    if (!(isInitialized && pendingRestore)) return null
    return (
        <CrashRecoveryPrompt
            onRestore={() => { void handleRestoreProject() }}
            onDiscard={dismissRestore}
        />
    )
})

const START_KEYS = ['hasStarted', 'handleStart', 'isPyodideReady', 'pyodideStatus'] as const

export const StartOverlayNode = React.memo(() => {
    const { hasStarted, handleStart, isPyodideReady, pyodideStatus } = useAppStateSlice(START_KEYS)
    if (hasStarted) return null
    return (
        <StartOverlay
            onStart={() => void handleStart()}
            isPyodideReady={isPyodideReady}
            pyodideStatus={pyodideStatus}
            hasWebGpu={typeof navigator !== 'undefined' && 'gpu' in navigator}
            hasNativeModule={
                typeof globalThis !== 'undefined'
                && !!(globalThis as { Module?: unknown }).Module
                || !!(globalThis as { hyphonPyodideReady?: boolean }).hyphonPyodideReady
            }
        />
    )
})

const LOADING_KEYS = ['hasStarted', 'isInitialized'] as const

export const LoadingOverlayNode = React.memo(() => {
    const { hasStarted, isInitialized } = useAppStateSlice(LOADING_KEYS)
    return <LoadingOverlay isVisible={hasStarted && !isInitialized} />
})

const AI_IMPORT_KEYS = [
    'isImportingAISong', 'aiImportStage', 'aiImportProgress', 'aiImportError',
    'setIsImportingAISong', 'setAiImportStage', 'setAiImportProgress', 'showToast',
] as const

export const AISongImportNode = React.memo(() => {
    const s = useAppStateSlice(AI_IMPORT_KEYS)
    return <AISongImportOverlay {...s} />
})
