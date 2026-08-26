// Side-effecting HUD mount. Lightweight DOM overlay that polls engineTelemetry.
import { engineTelemetry } from '../utils/engineTelemetry';
import { LATENCY_MODES, getStoredLatencyMode, setStoredLatencyMode, type LatencyMode } from '../utils/audioLatencyMode';
import { getOscillatorRegistry } from '../engines/backends/BackendRegistry';
import { getLastWebGpuProbe } from '../engines/backends/webgpuProbe';
import { transportSyncStore, syncStateLabel } from '../stores/transportSyncStore';
import { getWamHost } from '../audio/wam/WamHost';

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
  #${CONTAINER_ID} .backend-wam { background:#0ea5e9; }
  #${CONTAINER_ID} .backend-rust { background:#b45309; }
  #${CONTAINER_ID} .backend-open303 { background:#7c3aed }
  #${CONTAINER_ID} .cpu-ok { color:#86efac; }
  #${CONTAINER_ID} .cpu-warn { color:#fde047; }
  #${CONTAINER_ID} .cpu-hot { color:#f87171; }
  #${CONTAINER_ID} .hud-actions { display:flex; gap:8px; margin-top:8px; border-top:1px solid rgba(255,255,255,0.1); padding-top:8px; }
  #${CONTAINER_ID} button { background: rgba(255,255,255,0.1); border:1px solid rgba(255,255,255,0.2); color:#fff; padding:4px 8px; border-radius:4px; cursor:pointer; font-size:11px; }
  #${CONTAINER_ID} button:hover { background: rgba(255,255,255,0.2); }
  #${CONTAINER_ID} button[disabled] { opacity:0.4; cursor:default; }
  #${CONTAINER_ID} .hud-wam-actions { display:flex; gap:4px; margin-left:8px; }
  #${CONTAINER_ID} .hud-wam-actions button { padding:2px 6px; font-size:10px; }
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

    const probe = getLastWebGpuProbe();
    const probeSnap = runtime.webgpuProbe;
    const probeTitle = probeSnap
      ? JSON.stringify(probeSnap).replace(/"/g, '&quot;')
      : '';
    const gpuSessionSection = (() => {
      if (!probeSnap && !probe) {
        return `<div class="subheader">WebGPU session</div>
      <div class="row"><div style="flex:1">Probe</div><div style="min-width:72px;text-align:right">—</div></div>`;
      }
      const snap = probeSnap ?? {
        ok: probe!.ok,
        reason: probe!.reason,
        browser: probe!.browser,
        adapter: probe!.adapter,
        ts: probe!.ts,
      };
      if (snap.ok) {
        const desc = snap.adapter?.description || snap.adapter?.vendor || 'adapter';
        return `<div class="subheader">WebGPU session</div>
      <div class="row" title="${probeTitle}"><div style="flex:1">Status</div><div class="cpu-ok" style="min-width:72px;text-align:right">device-ready</div></div>
      <div class="row"><div style="flex:1">Adapter</div><div style="min-width:72px;text-align:right;font-size:10px">${desc}</div></div>`;
      }
      const reason = (snap.reason ?? 'WebGPU unavailable').replace(/</g, '&lt;').replace(/"/g, '&quot;');
      const browser = snap.browser?.engineHint ?? 'unknown';
      return `<div class="subheader">WebGPU session</div>
      <div class="row" title="${probeTitle}"><div style="flex:1">Status</div><div class="cpu-hot" style="min-width:120px;text-align:right">WebGPU unavailable</div></div>
      <div class="row" title="${reason}"><div style="flex:1">Reason</div><div class="cpu-hot" style="min-width:72px;text-align:right;font-size:10px;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${reason}</div></div>
      <div class="row"><div style="flex:1">Browser</div><div style="min-width:72px;text-align:right;font-size:10px">${browser}</div></div>`;
    })();

    const ts = runtime.transportSync;
    const syncSection = ts ? `<div class="subheader">Transport sync</div>
      <div class="row"><div style="flex:1">Mode</div><div style="min-width:72px;text-align:right">${ts.mode}</div></div>
      <div class="row"><div style="flex:1">State</div><div style="min-width:72px;text-align:right">${syncStateLabel(ts.state)}</div></div>
      <div class="row"><div style="flex:1">Device</div><div style="min-width:72px;text-align:right;font-size:10px">${ts.deviceName ?? '—'}</div></div>
      <div class="row"><div style="flex:1">Measured BPM</div><div style="min-width:72px;text-align:right">${ts.measuredBpm != null ? ts.measuredBpm.toFixed(1) : '—'}</div></div>
      <div class="row"><div style="flex:1">Phase err</div><div style="min-width:72px;text-align:right">${ts.phaseErrorMs.toFixed(1)} ms</div></div>
      <div class="row"><div style="flex:1">Jitter p95</div><div style="min-width:72px;text-align:right">${ts.jitterMs.toFixed(1)} ms</div></div>
      <div class="row"><div style="flex:1">Dropouts</div><div style="min-width:72px;text-align:right">${ts.droppedClocks}</div></div>
      <div class="hud-actions" style="margin-top:4px;border-top:none;padding-top:0"><button type="button" id="hud-resync-btn">Resync</button></div>` : '';

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
    // Phase-L1 — which realtime 303 path is actually audible.
    const liveHfActive = runtime.liveHighFidActive === true;
    const liveHfBadge = liveHfActive
        ? 'LIVE HIFID'
        : runtime.liveHighFidActive === false
          ? 'stock (degraded)'
          : '—';
    const liveHfClass = liveHfActive ? 'cpu-ok' : runtime.liveHighFidActive === false ? 'cpu-hot' : '';
    const liveHfCpu =
        runtime.liveHighFidCpuPercent != null ? `${runtime.liveHighFidCpuPercent.toFixed(0)}%` : '—';
    const liveHfOs = runtime.liveHighFidOversample != null ? `${runtime.liveHighFidOversample}×` : '—';
    const liveHfReason = runtime.liveHighFidFallbackReason ?? '';
    const liveSection = runtime.liveHighFidActive == null ? '' : `<div class="subheader">Live 303 path</div>
      <div class="row" title="${liveHfReason}"><div style="flex:1">Audible</div><div class="${liveHfClass}" style="min-width:96px;text-align:right;font-size:10px">${liveHfBadge}</div></div>
      <div class="row"><div style="flex:1">HiFi CPU</div><div style="min-width:72px;text-align:right">${liveHfCpu} @ ${liveHfOs}</div></div>
      ${liveHfReason ? `<div class="row" title="${liveHfReason}"><div style="flex:1">Fallback</div><div class="cpu-hot" style="min-width:72px;text-align:right;font-size:10px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${liveHfReason}</div></div>` : ''}`;

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

    // Oscillator backend chain (#1034): shows every backend in preference order,
    // which one is active, and why the higher-preference ones were skipped.
    const registry = getOscillatorRegistry();
    const resolution = registry?.getLastResolution() ?? null;
    const backendSection = (() => {
      if (!resolution) return '';
      const attemptRows = resolution.attempts.map((a) => {
        const active = a.id === resolution.active;
        const state = active ? 'ACTIVE' : a.reason ?? (a.ready ? 'ready' : 'not ready');
        const color = active ? '#86efac' : a.reason ? '#f87171' : '#9ca3af';
        return `<div class="row" title="${a.reason ?? ''}">
          <div class="badge backend-${a.id}">${a.id}</div>
          <div style="flex:1"></div>
          <div style="color:${color};font-size:10px;text-align:right;max-width:190px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${state}</div>
        </div>`;
      }).join('');
      const header = resolution.degraded
        ? `<div style="font-size:11px;color:#fde047" title="${resolution.reason ?? ''}">fallback: ${resolution.requested} → ${resolution.active}</div>`
        : `<div style="font-size:11px;opacity:0.7">preferred backend active (${resolution.active})</div>`;
      return `<div class="subheader">Oscillator backends</div>${header}${attemptRows}`;
    })();

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

    const wamRows = (runtime.wam2Slots ?? []).map((slot) => {
      const cls = slot.status === 'ready' ? 'cpu-ok' : slot.status === 'bypassed' ? 'cpu-warn' : 'cpu-hot';
      const err = slot.lastError ? ` title="${slot.lastError.replace(/"/g, '&quot;')}"` : '';
      const freeze = slot.offline === 'native'
        ? '<span title="Renders natively in an OfflineAudioContext" style="opacity:0.7">freeze ok</span>'
        : '<span title="Cannot be rendered in an OfflineAudioContext — track freeze is unavailable for this slot" style="color:#fbbf24">no freeze</span>';
      const mounted = slot.status === 'ready' || slot.status === 'bypassed';
      const bypassLabel = slot.status === 'bypassed' ? 'Unbypass' : 'Bypass';
      const controls = `<button type="button" class="hud-wam-bypass" data-slot="${slot.slotId}" ${mounted ? '' : 'disabled'}>${bypassLabel}</button><button type="button" class="hud-wam-restart" data-slot="${slot.slotId}">Restart</button>`;
      return `<div class="row"${err}><div class="badge backend-wam">wam2</div><div style="flex:1">${slot.slotId}<div style="font-size:10px;opacity:0.7">${slot.packageId}@${slot.version} · ${slot.origin} · ${freeze}</div></div><div class="${cls}" style="min-width:72px;text-align:right">${slot.status}</div><div style="width:48px;text-align:right" title="${slot.cpuPercent == null ? 'no per-slot meter (plugin exposes none)' : 'plugin-reported DSP load'}">${slot.cpuPercent == null ? '—' : `${slot.cpuPercent.toFixed(0)}%`}</div><div style="width:56px;text-align:right">${slot.latencyMs.toFixed(1)}ms</div><div class="hud-wam-actions">${controls}</div></div>`;
    }).join('');
    const coop = runtime.wam2Constraints
      ? `<div class="row"><div style="flex:1">COOP isolated</div><div style="min-width:72px;text-align:right">${runtime.wam2Constraints.crossOriginIsolated ? 'yes' : 'no'}</div></div>
         <div class="row"><div style="flex:1">Worklet / Worker</div><div style="min-width:72px;text-align:right">${runtime.wam2Constraints.audioWorklet ? 'AW' : '—'} / ${runtime.wam2Constraints.worker ? 'W' : '—'}</div></div>
         <div class="row"><div style="flex:1">BASE_URL</div><div style="min-width:72px;text-align:right;font-size:10px">${runtime.wam2Constraints.baseUrl}</div></div>`
      : '';
    const wamSection = `<div class="subheader">WAM2 slots</div>${wamRows || '<div class="row"><div style="flex:1;opacity:0.7">none mounted</div></div>'}${coop}`;

    container.innerHTML = `<div class="header">Engine HUD</div>${summary}${syncSection}${latencySection}${gpuSessionSection}${liveSection}${offlineSection}${backendSection}<div class="subheader">Worklets</div>${workletRows}${degradeNote}${wamSection}<div class="subheader">Subsystems</div>${rows}<div class="hud-actions"><button type="button" id="hud-export-btn">Download Report</button><button type="button" id="hud-copy-btn">Copy JSON</button></div>`;
  }

  // Event delegation: render() replaces innerHTML every 500ms, so per-render
  // listeners would be discarded. Bind once on the persistent container instead.
  container.addEventListener('click', (e) => {
    const target = e.target as HTMLElement | null;
    if (!target) return;
    if (target.classList.contains('hud-wam-bypass') || target.classList.contains('hud-wam-restart')) {
      const slotId = target.getAttribute('data-slot');
      const host = getWamHost();
      if (!slotId || !host) return;
      if (target.classList.contains('hud-wam-bypass')) {
        // Read current state from the host rather than the rendered label: the
        // HUD re-renders on a timer and could be up to one tick stale.
        host.setBypass(slotId, host.getSlotStatus(slotId) !== 'bypassed');
        render();
      } else {
        target.setAttribute('disabled', 'true');
        void host.restartSlot(slotId).finally(render);
      }
      return;
    }
    if (target.id === 'hud-export-btn') {
      engineTelemetry.exportReport();
    } else if (target.id === 'hud-resync-btn') {
      transportSyncStore.resync();
      render();
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
