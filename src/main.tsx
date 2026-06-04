import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './components/EngineHUD' // side-effect: register Engine HUD mount
import App from './App'
import { AppStateProvider } from './contexts/AppStateContext'
import { engineTelemetry } from './utils/engineTelemetry'

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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppStateProvider>
      <App />
    </AppStateProvider>
  </StrictMode>,
)
