// Side-effecting HUD mount. Lightweight DOM overlay that polls engineTelemetry.
import { engineTelemetry } from '../utils/engineTelemetry';

const CONTAINER_ID = 'engine-hud-root';
if (typeof window !== 'undefined' && !document.getElementById(CONTAINER_ID)) {
  const container = document.createElement('div');
  container.id = CONTAINER_ID;
  container.setAttribute('aria-hidden', 'true');
  container.setAttribute('data-nosnippet', 'true');
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
  `;
  document.head.appendChild(style);

  let visible = new URLSearchParams(location.search).get('hud') === '1';

  function render() {
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

    container.innerHTML = `<div class="header">Engine HUD</div>${rows}`;
  }

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
