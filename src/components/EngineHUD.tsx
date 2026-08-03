// Side-effecting HUD mount. Lightweight DOM overlay that polls engineTelemetry.
import { engineTelemetry } from '../utils/engineTelemetry';
import { LATENCY_MODES, getStoredLatencyMode, setStoredLatencyMode, type LatencyMode } from '../utils/audioLatencyMode';

const CONTAINER_ID = 'engine-hud-root';
if (typeof window !== 'undefined' && !document.getElementById(CONTAINER_ID)) {
  const container = document.createElement('div');
  container.id = CONTAINER_ID;

  // A11y: This is a developer-only diagnostic overlay (Ctrl+Shift+E to toggle).
  // Never announced to screen readers; not part of primary content.
  container.setAttribute('aria-hidden', 'true');
  container.setAttribute('data-nosnippet', 'true');
  // Inert is progressive enhancement (hides from a11y tree + input in supporting browsers)
  if ('inert' in container) {
    (container as any).inert = true;
  }

  document.body.appendChild(container);

  const style = document.createElement('style');
  style.textContent = `
  #${CONTAINER_ID} { position: fixed; right: 12px; top: 12px; width: 380px; max-height: 70vh; overflow: auto; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, 'Roboto Mono', 'Courier New', monospace; font-size:12px; background: rgba(0,0,0,0.65); color:#fff; padding:8px; border-radius:8px; z-index:99999; }
  #${CONTAINER_ID} .row { display:flex; align-items:center; gap:8px; padding:4px 0; border-bottom: 1px solid rgba(255,255,255,0.03); }
  #${CONTAINER_ID} .header { font-weight:700; margin-bottom:6px; }
  #${CONTAINER_ID} .subheader { font-size:11px; opacity:0.7; margin:6px 0 4px; text-transform:uppercase; letter-spacing:0.05em; }
  #${CONTAINER_ID} .badge { padding:2px 8px; border-radius:6px; font-weight:700; font-size:11px; }
  #${CONTAINER_ID} .backend-webgpu { background:#16a34a; }
  #${CONTAINER_ID} .backend-wasm { background:#0ea5e9; }
  #${CONTAINER_ID} .backend-js { background:#6b7280; }
  #${CONTAINER_ID} .backend-wav { background:#f59e0b; color:#000 }
  #${CONTAINER_ID} .backend-open303 { background:#7c3aed }
  #${CONTAINER_ID} .cpu-ok { color:#86efac; }
  #${CONTAINER_ID} .cpu-warn { color:#fde047; }
  #${CONTAINER_ID} .cpu-hot { color:#f87171; }
  #${CONTAINER_ID} .hud-actions { display:flex; gap:8px; margin-top:8px; border-top:1px solid rgba(255,255,255,0.1); padding-top:8px; }
  #${CONTAINER_ID} button { background: rgba(255,255,255,0.1); border:1px solid rgba(255,255,255,0.2); color:#fff; padding:4px 8px; border-radius:4px; cursor:pointer; font-size:11px; }
  #${CONTAINER_ID} button:hover { background: rgba(255,255,255,0.2); }
  `;
  document.head.appendChild(style);

  let visible = new URLSearchParams(location.search).get('hud') === '1';

  function cpuClass(pct: number): string {
    if (pct >= 80) return 'cpu-hot';
    if (pct >= 50) return 'cpu-warn';
    return 'cpu-ok';
  }

  function render() {
    if (!visible) {
      container.style.display = 'none';
      // Keep it inert while hidden so it stays out of the a11y tree / input.
      if ('inert' in container) { (container as HTMLElement & { inert: boolean }).inert = true; }
      return;
    }
    container.style.display = 'block';
    // Clear inert while shown so the action buttons are operable (inert blocks clicks).
    if ('inert' in container) { (container as HTMLElement & { inert: boolean }).inert = false; }

    const data = engineTelemetry.snapshot();
    const runtime = engineTelemetry.getRuntimeSnapshot();
    const keys = Object.keys(data).sort();

    const budgetClass = cpuClass(runtime.masterBudgetPercent);
    const summary = `<div class="subheader">Audio thread</div>
      <div class="row"><div style="flex:1">Master budget</div><div class="${budgetClass}" style="min-width:72px;text-align:right">${runtime.masterBudgetPercent.toFixed(1)}%</div></div>
      <div class="row"><div style="flex:1">Underruns</div><div style="min-width:72px;text-align:right">${runtime.totalUnderruns}</div></div>
      <div class="row"><div style="flex:1">Sample rate</div><div style="min-width:72px;text-align:right">${runtime.sampleRate != null ? runtime.sampleRate + ' Hz' : '—'}</div></div>
      <div class="row"><div style="flex:1">Base latency</div><div style="min-width:72px;text-align:right">${runtime.baseLatencyMs != null ? runtime.baseLatencyMs.toFixed(1) + ' ms' : '—'}</div></div>
      <div class="row"><div style="flex:1">Output latency</div><div style="min-width:72px;text-align:right">${runtime.outputLatencyMs != null ? runtime.outputLatencyMs.toFixed(1) + ' ms' : '—'}</div></div>
      <div class="row"><div style="flex:1">Latency hint (active)</div><div style="min-width:72px;text-align:right">${runtime.latencyHint ?? '—'}</div></div>
      <div class="row"><div style="flex:1">Glitches</div><div style="min-width:72px;text-align:right">${runtime.glitches.length}</div></div>`;

    const storedMode = getStoredLatencyMode();
    const modeButtons = LATENCY_MODES.map((mode) => {
      const active = mode === storedMode;
      const style = active
        ? 'background:#0ea5e9;border-color:#0ea5e9;'
        : '';
      return `<button type="button" class="hud-latency-btn" data-mode="${mode}" style="${style}">${mode}</button>`;
    }).join('');
    const modeAppliesNote = storedMode === runtime.latencyHint
      ? ''
      : '<div style="font-size:10px;opacity:0.7;margin-top:4px">Restart audio (reload) to apply</div>';
    const latencySection = `<div class="subheader">Latency mode</div>
      <div class="row" style="gap:4px">${modeButtons}</div>${modeAppliesNote}`;

    const offlineOs = runtime.offlineRenderOversample != null ? `${runtime.offlineRenderOversample}×` : '—';
    const offlineThreads = runtime.offlineRenderThreadCount != null ? String(runtime.offlineRenderThreadCount) : '—';
    const offlineLat = runtime.offlineRenderLatencyMs != null ? `${runtime.offlineRenderLatencyMs.toFixed(1)} ms` : '—';
    const gpuLat = runtime.gpuRenderLatencyMs != null ? `${runtime.gpuRenderLatencyMs.toFixed(1)} ms` : '—';
    const gpuBackend =
      runtime.gpuUsedGpu === true
        ? 'webgpu'
        : runtime.gpuUsedGpu === false
          ? 'cpu-fb'
          : '—';
    const gpuFb =
      runtime.gpuFallbackReason != null
        ? runtime.gpuFallbackReason.slice(0, 42)
        : '—';
    const gpuAvail =
      runtime.gpuAvailable === true ? 'yes' : runtime.gpuAvailable === false ? 'no' : '—';
    const hfReq = runtime.highFidRequested ?? '—';
    const hfActive = runtime.highFidActiveEngine ?? '—';
    const hfSelFb =
      runtime.highFidFallbackReason != null
        ? runtime.highFidFallbackReason.slice(0, 42)
        : '—';
    const offlineSection = `<div class="subheader">Offline 303</div>
      <div class="row"><div style="flex:1">Oversample</div><div style="min-width:72px;text-align:right">${offlineOs}</div></div>
      <div class="row"><div style="flex:1">Threads</div><div style="min-width:72px;text-align:right">${offlineThreads}</div></div>
      <div class="row"><div style="flex:1">Last render</div><div style="min-width:72px;text-align:right">${offlineLat}</div></div>
      <div class="row"><div style="flex:1">WebGPU</div><div style="min-width:72px;text-align:right">${gpuAvail}</div></div>
      <div class="row"><div style="flex:1">HiFi select</div><div style="min-width:72px;text-align:right;font-size:10px" title="${runtime.highFidRequested ?? ''}">${hfReq}</div></div>
      <div class="row"><div style="flex:1">HiFi active</div><div style="min-width:72px;text-align:right;font-size:10px">${hfActive}</div></div>
      <div class="row" title="${runtime.highFidFallbackReason ?? ''}"><div style="flex:1">HiFi fallback</div><div style="min-width:72px;text-align:right;font-size:10px">${hfSelFb}</div></div>
      <div class="row"><div style="flex:1">GPU 303</div><div style="min-width:72px;text-align:right">${gpuBackend} ${gpuLat}</div></div>
      <div class="row" title="${runtime.gpuFallbackReason ?? ''}"><div style="flex:1">GPU fallback</div><div style="min-width:72px;text-align:right;font-size:10px">${gpuFb}</div></div>`;

    const workletNames = ['clock', 'open303', 'rubberband', 'vocoder'];
    const workletRows = workletNames.map((name) => {
      const w = runtime.worklets[name];
      const cpu = w ? w.cpuPercent.toFixed(1) : '—';
      const und = w ? String(w.underruns) : '—';
      const cls = w ? cpuClass(w.cpuPercent) : '';
      return `<div class="row"><div style="flex:1">${name}</div><div class="${cls}" style="min-width:56px;text-align:right">${cpu}%</div><div style="width:48px;text-align:right" title="underruns">${und}</div></div>`;
    }).join('');

    const rows = keys.map(k => {
      const v = data[k];
      const backend = v?.resolution?.backend || 'unknown';
      const p50 = v?.p50 != null ? v.p50.toFixed(1) : '-';
      const p95 = v?.p95 != null ? v.p95.toFixed(1) : '-';
      const err = v?.errors?.count ? `${v.errors.count} err` : '';
      const wCpu = v?.worklet?.cpuPercent != null ? `${v.worklet.cpuPercent.toFixed(0)}%` : '';
      return `<div class="row"><div class="badge backend-${backend}">${backend}</div><div style="flex:1">${k}</div><div style="min-width:48px;text-align:right">${wCpu}</div><div style="min-width:72px;text-align:right">${p50}/${p95} ms</div><div style="width:48px;text-align:right">${err}</div></div>`;
    }).join('');

    const degradeNote = runtime.degradations.length
      ? `<div class="subheader">Degradations</div><div style="font-size:11px;opacity:0.85">${runtime.degradations.slice(-3).map(d => `${d.step}: ${d.active ? 'ON' : 'off'}`).join(' · ')}</div>`
      : '';

    container.innerHTML = `<div class="header">Engine HUD</div>${summary}${latencySection}${offlineSection}<div class="subheader">Worklets</div>${workletRows}${degradeNote}<div class="subheader">Subsystems</div>${rows}<div class="hud-actions"><button type="button" id="hud-export-btn">Download Report</button><button type="button" id="hud-copy-btn">Copy JSON</button></div>`;
  }

  // Event delegation: render() replaces innerHTML every 500ms, so per-render
  // listeners would be discarded. Bind once on the persistent container instead.
  container.addEventListener('click', (e) => {
    const target = e.target as HTMLElement | null;
    if (!target) return;
    if (target.id === 'hud-export-btn') {
      engineTelemetry.exportReport();
    } else if (target.classList.contains('hud-latency-btn')) {
      const mode = target.getAttribute('data-mode') as LatencyMode | null;
      if (mode) {
        setStoredLatencyMode(mode);
        render();
      }
    } else if (target.id === 'hud-copy-btn') {
      const json = engineTelemetry.generateReportJSON();
      if (navigator.clipboard?.writeText) {
        const orig = target.textContent;
        navigator.clipboard.writeText(json).then(() => {
          target.textContent = 'Copied!';
          setTimeout(() => { target.textContent = orig; }, 1500);
        }).catch(() => { /* clipboard denied; no-op */ });
      }
    }
  });

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
