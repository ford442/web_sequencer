import { lazy, Suspense } from 'react'
import { useAppStateSelector } from './contexts/AppStateContext'
import { useUIModalsStore, uiModalsStore } from '@/stores/uiModalsStore'

import TransportHeader from './components/appParts/TransportHeader'
import SequencerNode from './components/appParts/SequencerNode'
import ContextMenuNode from './components/appParts/ContextMenuNode'
import RackNode from './components/appParts/RackNode'
import KeyboardNode from './components/appParts/KeyboardNode'
import { BottomBarNode } from './components/appParts/BottomBarNode'
import { AppEffects } from './components/appParts/AppEffects'
import {
    AISongImportNode, CrashRecoveryNode, LoadingOverlayNode, StartOverlayNode, ToastNode,
} from './components/appParts/AppOverlays'
import { ModalHosts } from './components/appParts/ModalHosts'
import { LyricTrackNode, MobileTransportNode, SessionNode, SongModeNode } from './components/appParts/PanelNodes'

import { WhatsNewBanner } from './components/help/WhatsNewBanner'
import { UpdateAvailableToast } from '@/components/UpdateAvailableToast'
import { SEQUENCER_STYLES } from './components/sequencer/constants'
import { MasterLoudnessMeter } from './components/MasterLoudnessMeter'
import { PatchBay } from './components/PatchBay'
import { EngineDegradationBanner } from './components/EngineDegradationBanner'
import { A11yAnnouncer } from './components/A11yAnnouncer'
import { useCompactLayoutContext } from './contexts/CompactLayoutContext'
import { useSurfaceTexture } from './hooks/useSurfaceTexture'

// Route-split: neither renders on first paint — each is behind a query-param
// dev view or the 3D-mode switch — so keep them out of the entry chunk and
// fetch on demand. (The modals are lazy in appParts/ModalHosts.tsx.)
const Studio3D = lazy(() => import('./components/Studio3D').then(module => ({ default: module.Studio3D })));
const VisualStyleShowcase = lazy(() => import('./components/ui/VisualStyleShowcase').then(module => ({ default: module.VisualStyleShowcase })));

/**
 * Layout shell. It reads no app state of its own beyond the background image
 * and the 3D flag: every region below subscribes to exactly the fields it
 * renders (see the `appParts/` components), so a state change re-renders that
 * region and nothing else.
 */
export const App: React.FC = () => {
    const backgroundImage = useAppStateSelector((s) => s.backgroundImage);

    // Sourced directly from the store so this flag alone never forces a
    // re-render on an unrelated app-state update.
    const is3DMode = useUIModalsStore((s) => s.is3DMode);
    const setIs3DMode = uiModalsStore.setIs3DMode;

    const { isCompact, toggleCompact } = useCompactLayoutContext();

    useSurfaceTexture();

    const showVisualReview = typeof location !== 'undefined'
        && new URLSearchParams(location.search).has('visual-review');

    if (showVisualReview) {
        return (
            <Suspense fallback={null}>
                <VisualStyleShowcase />
            </Suspense>
        );
    }

    if (is3DMode) {
        return (
            <Suspense fallback={<div className="flex items-center justify-center h-screen w-screen bg-black text-cyan-400 font-orbitron text-xl tracking-widest animate-pulse">LOADING 3D STUDIO...</div>}>
                <AppEffects />
                <Studio3D
                    header={<TransportHeader />}
                    sequencer={<SequencerNode />}
                    keyboard={<KeyboardNode />}
                    rack={<RackNode />}
                    onExit={() => setIs3DMode(false)}
                />
            </Suspense>
        )
    }

    return (
        <div className={`flex flex-col h-screen w-screen bg-gradient-to-br from-[#050709] via-[#080a0b] to-[#0a0c0f] text-gray-200 overflow-hidden font-sans relative bg-cover bg-center ${isCompact ? 'hyphon-compact' : ''}`} style={{ backgroundImage: backgroundImage ? `url(${backgroundImage})` : undefined }}>
            <AppEffects />
            <a href="#main-content" className="skip-link">Skip to main content</a>
            <A11yAnnouncer />
            <style>{SEQUENCER_STYLES}</style>
            <ToastNode />
            <UpdateAvailableToast />
            <CrashRecoveryNode />
            {backgroundImage && <div className="absolute inset-0 bg-black/60 pointer-events-none z-0"></div>}
            <StartOverlayNode />
            <LoadingOverlayNode />

            <AISongImportNode />

            <ModalHosts />

            <TransportHeader onToggleCompact={toggleCompact} isCompactLayout={isCompact} />

            <EngineDegradationBanner />

            <SongModeNode />

            <SessionNode />

            <MobileTransportNode />

            <LyricTrackNode />

            <main id="main-content" className={`flex-1 relative bg-gradient-to-b from-[#0a0e14] via-[#111827] to-[#050709] shadow-inner flex flex-col justify-start z-10 overflow-y-auto overscroll-y-contain ${isCompact ? 'pb-28' : 'pb-12'} hyphon-main-scroll`}>
                <WhatsNewBanner />
                <div className={`w-full max-w-[1000px] mx-auto shrink-0 pt-4 sm:pt-6 px-2 sm:px-0 ${isCompact ? 'h-[min(42vh,360px)] min-h-[240px]' : 'h-[440px]'}`}>
                    <SequencerNode />
                </div>
                <ContextMenuNode />

                <div className="w-full max-w-[1000px] mx-auto shrink-0 mt-2 px-2 sm:px-4">
                    <div className={`hyphon-rack-shell overflow-hidden ${isCompact ? 'h-[min(40vh,340px)] min-h-[260px]' : 'h-[380px]'}`}>
                        <RackNode />
                    </div>
                </div>

                {/* Master true-peak limiter + BS.1770 loudness meters, sitting
                    with the rack because it measures the master bus output. */}
                <div className="w-full max-w-[1000px] mx-auto shrink-0 mt-2 px-2 sm:px-4">
                    <MasterLoudnessMeter />
                </div>

                {/* Routing editor — collapsed by default so the rack stays the
                    focus; opening it costs nothing until the engine publishes
                    a patch controller. */}
                <details className="w-full max-w-[1000px] mx-auto shrink-0 mt-2 px-2 sm:px-4">
                    <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-widest text-gray-500 hover:text-cyan-300">
                        Patch Bay
                    </summary>
                    <div className="mt-2">
                        <PatchBay />
                    </div>
                </details>

                <div className="shrink-0 py-3 sm:py-4 mt-2 max-w-[1000px] mx-auto w-full px-2 sm:px-4">
                    <KeyboardNode />
                </div>
            </main>

            <BottomBarNode />
        </div>
    )
}

export default App
