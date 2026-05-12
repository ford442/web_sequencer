// Side-effecting HUD mount. Lightweight DOM overlay that polls engineTelemetry.
import { engineTelemetry } from '../utils/engineTelemetry';

let limiterEnabled = true;
let limiterThreshold = 0.95;
let limiterSetter: ((threshold: number | null) => void) | undefined;

export function registerLimiterApi(setter: (threshold: number | null) => void) {
  limiterSetter = setter;
}

function applyLimiter() {
  if (!limiterSetter) return;
  limiterSetter(limiterEnabled ? limiterThreshold : null);
}

const CONTAINER_ID = 'engine-hud-root';
if (typeof window !== 'undefined' && !document.getElementById(CONTAINER_ID)) {
  const container = document.createElement('div');
  container.id = CONTAINER_ID;
  document.body.appendChild(container);

  const style = document.createElement('style');
  style.textContent = `
  #${CONTAINER_ID} { position: fixed; right: 12px; top: 12px; width: 360px; max-height: 60vh; overflow: auto; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, 'Roboto Mono', 'Courier New', monospace; font-size:12px; background: rgba(0,0,0,0.65); color:#fff; padding:8px; border-radius:8px; z-index:99999; }
  #${CONTAINER_ID} .row { display:flex; align-items:center; gap:8px; padding:4px 0; border-bottom: 1px solid rgba(255,255,255,0.03); }
  #${CONTAINER_ID} .header { font-weight:700; margin-bottom:6px; }
  #${CONTAINER_ID} .badge { padding:2px 8px; border-radius:6px; font-weight:700; font-size:11px; }
  #${CONTAINER_ID} .backend-webgpu { background:#16a34a; }
  #${CONTAINER_ID} .backend-wasm { background:#0ea5e9; }
  #${CONTAINER_ID} .backend-js { background:#6b7280; }
  #${CONTAINER_ID} .backend-wav { background:#f59e0b; color:#000 }
  #${CONTAINER_ID} .backend-open303 { background:#7c3aed }
  #${CONTAINER_ID} .limiter-btn { background:#7c3aed; border:none; color:#fff; padding:2px 8px; border-radius:4px; cursor:pointer; font-family:inherit; font-size:11px; }
  #${CONTAINER_ID} .limiter-btn.off { background:#6b7280; }
  #${CONTAINER_ID} input[type=range] { flex:1; cursor:pointer; }
  `;
  document.head.appendChild(style);

  let visible = new URLSearchParams(location.search).get('hud') === '1';

  // Build persistent structure
  const headerEl = document.createElement('div');
  headerEl.className = 'header';
  headerEl.textContent = 'Engine HUD';
  container.appendChild(headerEl);

  // Limiter controls (persistent so focus/input state survives telemetry refreshes)
  const limiterRow = document.createElement('div');
  limiterRow.className = 'row';
  limiterRow.style.borderBottom = '1px solid rgba(255,255,255,0.12)';
  limiterRow.innerHTML = `
    <div style="font-weight:700;width:64px">LIMITER</div>
    <button class="limiter-btn ${limiterEnabled ? '' : 'off'}" id="hud-limiter-toggle">${limiterEnabled ? 'ON' : 'OFF'}</button>
    <input type="range" id="hud-limiter-threshold" min="0.5" max="1.0" step="0.01" value="${limiterThreshold}">
    <div id="hud-limiter-value" style="min-width:40px;text-align:right">${limiterThreshold.toFixed(2)}</div>
  `;
  container.appendChild(limiterRow);

  const telemetryEl = document.createElement('div');
  telemetryEl.id = 'engine-hud-telemetry';
  container.appendChild(telemetryEl);

  // Event delegation for limiter controls
  const toggleBtn = limiterRow.querySelector<HTMLButtonElement>('#hud-limiter-toggle')!;
  const thresholdInput = limiterRow.querySelector<HTMLInputElement>('#hud-limiter-threshold')!;
  const valueDisplay = limiterRow.querySelector<HTMLDivElement>('#hud-limiter-value')!;

  toggleBtn.addEventListener('click', () => {
    limiterEnabled = !limiterEnabled;
    toggleBtn.textContent = limiterEnabled ? 'ON' : 'OFF';
    toggleBtn.className = `limiter-btn ${limiterEnabled ? '' : 'off'}`;
    applyLimiter();
  });

  thresholdInput.addEventListener('input', () => {
    limiterThreshold = parseFloat(thresholdInput.value);
    valueDisplay.textContent = limiterThreshold.toFixed(2);
    applyLimiter();
  });

  const render = () => {
    if (!visible) { container.style.display = 'none'; return; }
    container.style.display = 'block';
    const data = engineTelemetry.snapshot();
    const keys = Object.keys(data).sort();
    const rows = keys.map(k => {
      const v = data[k];
      const backend = v?.resolution?.backend || 'unknown';
      const p50 = v?.p50 != null ? v.p50.toFixed(1) : '-';
      const p95 = v?.p95 != null ? v.p95.toFixed(1) : '-';
      const err = v?.errors?.count ? `${v.errors.count} err` : '';
      return `<div class="row"><div class="badge backend-${backend}">${backend}</div><div style="flex:1">${k}</div><div style="min-width:90px;text-align:right">${p50}/${p95} ms</div><div style="width:64px;text-align:right">${err}</div></div>`;
    }).join('');

    telemetryEl.innerHTML = rows;
  };

  render();
  const timer = setInterval(render, 500);

  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'e') {
      visible = !visible;
      render();
    }
  });

  // Cleanup not necessary for dev overlay; keep mounted for session lifetime.
}
