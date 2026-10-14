import React, { useCallback, useEffect, useState } from 'react'
import { useAppStateSlice } from '../../contexts/AppStateContext'
import { Toast } from '../Toast'
import { CrashRecoveryPrompt } from '@/components/CrashRecoveryPrompt'
import { StartOverlay } from '../StartOverlay'
import { useHyphonNativeReady } from '../../hooks/useHyphonNativeReady'
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

/**
 * True only when WebGPU can actually be used: `navigator.gpu` exists AND
 * `requestAdapter()` resolves to an adapter. `'gpu' in navigator` alone is true
 * on machines with no usable GPU, which made the splash claim WebGPU was ready
 * right before the app fell back to JS (#1396).
 */
function useWebGpuAdapterAvailable(): boolean {
    const [available, setAvailable] = useState(false)
    useEffect(() => {
        let cancelled = false
        const gpu = typeof navigator !== 'undefined'
            ? (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu
            : undefined
        if (!gpu) return
        gpu.requestAdapter()
            .then((adapter) => { if (!cancelled) setAvailable(adapter != null) })
            .catch(() => { if (!cancelled) setAvailable(false) })
        return () => { cancelled = true }
    }, [])
    return available
}

export const StartOverlayNode = React.memo(() => {
    const { hasStarted, handleStart, isPyodideReady, pyodideStatus } = useAppStateSlice(START_KEYS)
    const hasWebGpu = useWebGpuAdapterAvailable()
    const hasNativeModule = useHyphonNativeReady()
    if (hasStarted) return null
    return (
        <StartOverlay
            onStart={() => void handleStart()}
            isPyodideReady={isPyodideReady}
            pyodideStatus={pyodideStatus}
            hasWebGpu={hasWebGpu}
            hasNativeModule={hasNativeModule}
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
