import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './components/EngineHUD' // side-effect: register Engine HUD mount
import App from './App'
import { AppStateProvider } from './contexts/AppStateContext'
import { CompactLayoutProvider } from './contexts/CompactLayoutContext'
import { engineTelemetry } from './utils/engineTelemetry'
import { automationStore } from './stores/automationStore'
import { e2eTransportSnapshot } from './e2e/probe'
// Direct module import, not the './audio/wam' barrel: the barrel re-exports the
// official-SDK loader, and main.tsx must stay free of any path to it.
import { getWamHost, type WamHost } from './audio/wam/WamHost'

// Register the engine-report export hook at app bootstrap (NOT on HUD/component
// mount) so it is available regardless of view state — a user hitting an audio
// glitch may never have opened the HUD. Gated to dev builds or ?devtools so it is
// not ambiently exposed in the public build.
if (
  import.meta.env.DEV ||
  (typeof location !== 'undefined' && new URLSearchParams(location.search).has('devtools'))
) {
  const w = window as unknown as { __devtools?: Record<string, unknown> }
  w.__devtools = w.__devtools || {}
  w.__devtools.exportEngineReport = () => {
    engineTelemetry.exportReport()
    console.log('[devtools] engine report exported')
  }
}

// Playwright E2E hooks (?e2e=1) — read-only automation store introspection.
if (typeof location !== 'undefined' && new URLSearchParams(location.search).has('e2e')) {
  const w = window as unknown as {
    __HYPHON_E2E__?: Record<string, (...args: never[]) => unknown>
  }
  w.__HYPHON_E2E__ = {
    getAutomationLaneCount: () => {
      const snap = e2eTransportSnapshot();
      return snap.laneCount || automationStore.getState().lanes.length;
    },
    getRbsAutomationLaneCount: () =>
      automationStore.getState().lanes.filter((l) => l.source === 'rbs').length,
    getAutomationPlaybackStep: () => e2eTransportSnapshot().step,
    getSessionPlayingCount: () => window.__HYPHON_E2E_SESSION__?.playingCount ?? 0,
    getSessionLastApplyStep: () => window.__HYPHON_E2E_SESSION__?.lastApplyStep ?? -1,
    setLiveAutomatedValue: (target: string, param: string, value: number) => {
      automationStore.setLiveValues({ [`${target}:${param}`]: value });
    },
    clearLiveAutomatedValues: () => {
      automationStore.clearLiveValues();
    },

    // --- WAM2 (Phase B) ---------------------------------------------------
    // Exposed as hooks rather than letting a spec `import('/src/...')`: that
    // specifier only resolves under the Vite dev server, and CI runs the specs
    // against the built `dist/` via `pnpm preview`.
    restoreWam2SongState: (payload: unknown) =>
      getWamHost()?.restore(payload as Parameters<WamHost['restore']>[0]) ?? null,
    getWam2SlotTelemetry: () => getWamHost()?.telemetry() ?? null,
    getWam2SlotBypassGain: (slotId: string) =>
      getWamHost()?.getSlotPorts(slotId)?.bypass.gain.value ?? null,
    getWam2SlotDescriptor: (slotId: string) => getWamHost()?.getSlotDescriptor(slotId) ?? null,
    getAudioContextTime: () => getWamHost()?.audioContextTime() ?? null,
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppStateProvider>
      <CompactLayoutProvider>
        <App />
      </CompactLayoutProvider>
    </AppStateProvider>
  </StrictMode>,
)
