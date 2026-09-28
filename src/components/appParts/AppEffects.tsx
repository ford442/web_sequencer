import { useEffect } from 'react'
import { useAppStateSlice } from '../../contexts/AppStateContext'
import { useUIModalsStore } from '@/stores/uiModalsStore'
import { prefetchOrtWhenIdle } from '@/services/ortRuntime'
import { engineDegradationStore } from '../../stores/engineDegradationStore'
import { useA11yPlaybackAnnouncements } from '../../hooks/useA11yPlaybackAnnouncements'

const A11Y_KEYS = [
    'isPlaying', 'isAutomationRecording', 'selectedTrack', 'activeTrackSlots',
    'viewMode', 'automationParam', 'isSongModeActive', 'currentSongMeasure',
] as const

/**
 * App-level side effects that need app state but render nothing. Each lives in
 * its own component so the state it watches (the playing measure, say) re-renders
 * only that component — not `App` and everything under it.
 */
export function AppEffects() {
    return (
        <>
            <PlaybackAnnouncements />
            <OrtPrefetch />
            <EngineDegradationToasts />
        </>
    )
}

function PlaybackAnnouncements() {
    useA11yPlaybackAnnouncements(useAppStateSlice(A11Y_KEYS))
    return null
}

/** Warm the ONNX Runtime chunk once the sequencer is interactive, so the first
 * TTS use is not a cold multi-megabyte fetch. Runs on the idle callback and
 * only after `hasStarted`, so it is off both the first-paint and the
 * user-gesture paths — see prefetchOrtWhenIdle(). */
function OrtPrefetch() {
    const hasStarted = useUIModalsStore((s) => s.hasStarted)
    useEffect(() => {
        if (!hasStarted) return
        prefetchOrtWhenIdle()
    }, [hasStarted])
    return null
}

const TOAST_KEYS = ['showToast'] as const

function EngineDegradationToasts() {
    const { showToast } = useAppStateSlice(TOAST_KEYS)
    useEffect(() => {
        engineDegradationStore.setToastHandler((message, type) => {
            showToast(message, type === 'error' ? 'error' : 'info')
        })
        return () => engineDegradationStore.setToastHandler(null)
    }, [showToast])
    return null
}
