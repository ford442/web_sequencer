import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './components/EngineHUD' // side-effect: register Engine HUD mount
import App from './App'
import { AppStateProvider } from './contexts/AppStateContext'
import { CompactLayoutProvider } from './contexts/CompactLayoutContext'
import { engineTelemetry, isAppleWebKit, logEngineFallback } from './utils/engineTelemetry'
import { automationStore } from './stores/automationStore'
import { e2eTransportSnapshot } from './e2e/probe'
// Direct module import, not the './audio/wam' barrel: the barrel re-exports the
// official-SDK loader, and main.tsx must stay free of any path to it.
import { getWamHost, type WamHost } from './audio/wam/WamHost'
import { swUpdateStore } from '@/stores/swUpdateStore'

/**
 * Load public/hyphon_native.js without blocking first paint.
 *
 * Vite used to inline index.html's `await import(\`${BASE_URL}hyphon_native.js\`)`
 * into the assets chunk as `import("./hyphon_native.js")`, which 404s (the file
 * lives at the site root, not next to the JS bundle). The whole module then sat
 * in vite-plugin-top-level-await's `__tla` wrapper, so StartOverlay never
 * mounted — Playwright E2E waited 90s for `start-overlay` on every spec.
 */
function loadHyphonNative(): void {
  const w = window as unknown as { Module?: unknown; HYPHON_PYODIDE_BASE_URL?: string }
  w.HYPHON_PYODIDE_BASE_URL ??= `${import.meta.env.BASE_URL}pyodide/`
  if (w.Module) return

  // Playwright WebKit: instantiating threaded hyphon_native.wasm kills the
  // renderer after boot (`Target crashed` in dismissHelpTips). E2E still needs
  // the overlay button enabled (canStart = pyodide ∧ native).
  const e2e = typeof location !== 'undefined' && new URLSearchParams(location.search).has('e2e')
  if (e2e && isAppleWebKit()) {
    logEngineFallback(
      'pyodide',
      'pyodide',
      'skipped threaded hyphon_native.wasm on WebKit E2E (renderer abort)',
    )
    w.Module = { __hyphonWebKitE2EStub: true }
    globalThis.hyphonPyodideReady = true
    window.dispatchEvent(new CustomEvent('hyphon-pyodide-ready'))
    return
  }

  const moduleUrl = new URL('hyphon_native.js', document.baseURI).href
  void import(/* @vite-ignore */ moduleUrl)
    .then(async (ns: { default: () => Promise<unknown> }) => {
      w.Module = await ns.default()
    })
    .catch((err: unknown) => {
      console.error('[hyphon] failed to load hyphon_native.js', err)
    })
}

loadHyphonNative()

/**
 * Registers public/sw.js in production builds only. Skipped under Playwright
 * `?e2e=1` unless `?pwa=1` is also present — the existing E2E matrix (audio
 * engine boot, worklet, automation specs) never needs a service worker in
 * the loop, and this keeps it byte-for-byte unaffected; the offline /
 * crossOriginIsolated specs added for this feature pass `?pwa=1` to opt in.
 *
 * updateViaCache: 'none' makes the browser always re-fetch sw.js itself
 * (bypassing HTTP cache) so its build-id stamp — and therefore the standard
 * install/waiting/activate update lifecycle — is detected promptly. See
 * docs/deployment/ADR_PWA_SERVICE_WORKER_COEP.md.
 */
function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return
  const params = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null
  if (params?.has('e2e') && !params.has('pwa')) return

  window.addEventListener('load', () => {
    // clients.claim() in sw.js's activate handler fires `controllerchange`
    // the very first time a page becomes controlled too — including on a
    // brand-new visitor's first-ever load, not just on a later update. Only
    // reload when *this* page actually requested the switch (clicked
    // "Reload" on the update toast), never on that first-install claim.
    let applyUpdateRequested = false
    let reloaded = false

    void navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`, { updateViaCache: 'none' })
      .then((registration) => {
        const offerReload = (worker: ServiceWorker | null) => {
          if (!worker) return
          swUpdateStore.notifyUpdateAvailable(() => {
            applyUpdateRequested = true
            worker.postMessage('SKIP_WAITING')
          })
        }
        // An update already sat in `waiting` before this page even registered
        // (installed by another tab).
        offerReload(registration.waiting)

        registration.addEventListener('updatefound', () => {
          const installing = registration.installing
          installing?.addEventListener('statechange', () => {
            if (installing.state === 'installed' && navigator.serviceWorker.controller) {
              offerReload(registration.waiting)
            }
          })
        })
      })
      .catch((err: unknown) => {
        console.warn('[sw] registration failed', err)
      })

    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloaded || !applyUpdateRequested) return
      reloaded = true
      window.location.reload()
    })
  })
}

registerServiceWorker()

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

    // --- Live high-fid 303 (Phase L1) -------------------------------------
    // Which realtime 303 path is audible, and why it stepped down if it did.
    getLiveHighFidState: () => {
      const runtime = engineTelemetry.getRuntimeSnapshot();
      return {
        requested: runtime.liveHighFidRequested,
        active: runtime.liveHighFidActive,
        reason: runtime.liveHighFidFallbackReason,
        cpuPercent: runtime.liveHighFidCpuPercent,
        oversample: runtime.liveHighFidOversample,
      };
    },
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
