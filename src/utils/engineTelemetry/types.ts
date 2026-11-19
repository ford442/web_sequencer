// Telemetry data + report shapes. Type-only: no runtime code, no DOM.

import type { TransportSyncTelemetry } from '../../midi/clock/types';
import type { Wam2RuntimeConstraints, Wam2SlotTelemetry } from '../../audio/wam/types';
import type { WebGpuProbeSnapshot } from '../../engines/backends/webgpuProbe';
import type { HyphonNativeThreading } from '../../audio-worklets/hyphonNativeImports';
import type { BrowserCapabilities } from './capabilities';

export type Resolution = { backend: string; reason?: string; ts: number };

/** Shared GPUDevice health (#1345): losses, recoveries, uncaptured errors. */
export type WebGpuDeviceTelemetry = {
  losses: number;
  /** Losses followed by a re-probe (automatic or intentional restart). */
  recoveries: number;
  lastLoss: { reason: string; message: string; intentional: boolean; ts: number } | null;
  uncapturedErrors: number;
  lastError: { type: string; message: string; deviceLabel: string; ts: number } | null;
};

export type WorkletPerfSample = {
  cpuPercent: number;
  underruns: number;
  processUs: number;
  quantumUs: number;
  blockFrames: number;
  ts: number;
};

export type GlitchEvent = {
  kind: string;
  detail?: Record<string, unknown>;
  ts: number;
};

export type TelemetryData = {
  resolution?: Resolution | null;
  resolutionHistory: Resolution[];
  latencies: number[];
  errors: { count: number; lastError?: string; lastTs?: number | null };
  maxLatencySamples: number;
  worklet?: WorkletPerfSample;
  workletCpuHistory: number[];
};

export type RuntimeTelemetry = {
  worklets: Map<string, WorkletPerfSample>;
  glitches: GlitchEvent[];
  outputLatencyMs: number | null;
  masterBudgetPercent: number;
  totalUnderruns: number;
  degradations: Array<{ step: string; active: boolean; reason: string; ts: number }>;
  offlineRenderThreadCount: number | null;
  offlineRenderOversample: number | null;
  offlineRenderLatencyMs: number | null;
  /** Phase-3 / #976 — last GPU 303 render wall latency (ms). */
  gpuRenderLatencyMs: number | null;
  /** Phase-3 — bytes read back from GPU on last successful gpu-highfid render. */
  gpuReadbackBytes: number | null;
  /** Phase-3 — why GPU path fell back to highfid-cpu (null if GPU used). */
  gpuFallbackReason: string | null;
  /** Phase-3 — whether the last gpu-highfid attempt used the WGSL path. */
  gpuUsedGpu: boolean | null;
  /** Phase-4 — navigator.gpu (or last selection probe) availability. */
  gpuAvailable: boolean | null;
  /** Phase-4 — last requested high-fid / model303 selection. */
  highFidRequested: string | null;
  /** Phase-4 — effective offline engine after fallback (gpu-highfid | highfid-cpu | …). */
  highFidActiveEngine: string | null;
  /** Phase-4 — realtime worklet model used while a high-fid voice is selected. */
  highFidRealtimeModel: string | null;
  /** Phase-4 — selection-time fallback reason (distinct from last render). */
  highFidFallbackReason: string | null;
  /** Phase-L1 — realtime 303 voice a track requested (`live-highfid` or other). */
  liveHighFidRequested: string | null;
  /** Phase-L1 — whether the live diode-ladder voice is the audible path. */
  liveHighFidActive: boolean | null;
  /** Phase-L1 — why the live high-fid voice stepped down to stock (null if fine). */
  liveHighFidFallbackReason: string | null;
  /** Phase-L1 — rolling CPU share of the quantum used by the live high-fid voice. */
  liveHighFidCpuPercent: number | null;
  /** Phase-L1 — oversample factor the live high-fid voice runs at (1 or 2). */
  liveHighFidOversample: number | null;
  /** Phase-L2 — live A/B requested on the last part that changed it. */
  liveAbArmed: boolean | null;
  /** Phase-L2 — both buses wired (armed and the part is on live-highfid). */
  liveAbEngaged: boolean | null;
  /** Phase-L2 — equal-power blend, 0 = stock, 1 = live high-fid. */
  liveAbMix: number | null;
  /** Phase-L2 — rolling CPU share of the quantum used by the stock side. */
  liveAbStockCpuPercent: number | null;
  /** Phase-L2 — rolling CPU share of the quantum used by the high-fid side. */
  liveAbHighFidCpuPercent: number | null;
  /** P0 audio foundation — live AudioContext.sampleRate at construction. */
  sampleRate: number | null;
  /** Sample rate passed to AudioContextOptions, or null for device native. */
  requestedSampleRate: number | null;
  /** Why the requested rate was not used (null if match or native). */
  sampleRateFallback: string | null;
  /** AudioContext.sinkId when setSinkId is supported. */
  sinkId: string | null;
  /** Human-readable output device label. */
  sinkLabel: string | null;
  /** P0 audio foundation — live AudioContext.baseLatency, in ms. */
  baseLatencyMs: number | null;
  /** P0 audio foundation — latencyHint requested when the context was created. */
  latencyHint: string | null;
  /** renderSizeHint passed to AudioContextOptions (null = omitted / unsupported). */
  renderSizeHintRequested: string | number | null;
  /** AudioContext.renderQuantumSize observed (null = browser does not expose it). */
  renderQuantumSize: number | null;
  /** Why renderSizeHint / constructor sinkId was dropped (null if honoured). */
  contextOptionFallback: string | null;
  /** Step lookahead the internal clock was given, derived from the live context's latency (ms). */
  stepLookaheadMs: number | null;
  transportSync: TransportSyncTelemetry | null;
  wam2Slots: Wam2SlotTelemetry[];
  wam2Constraints: Wam2RuntimeConstraints | null;
  /** Session WebGPU probe (JSON-safe; no GPUDevice). */
  webgpuProbe: WebGpuProbeSnapshot | null;
  webgpuDevice: WebGpuDeviceTelemetry;
  hyphonNativeHeap: HyphonNativeHeapTelemetry | null;
};

export interface WorkletPerfReport {
  cpuPercent: number;
  underruns: number;
  lastProcessUs: number;
  lastQuantumUs: number;
  lastUpdate: number | null;
}

export interface SubsystemReport {
  resolution: Resolution | null;
  p50: number | null;
  p95: number | null;
  sampleCount: number;
  p95Reliable: boolean;
  last: number[];
  errors: { count: number; lastError?: string; lastTs?: number | null };
  resolutionHistory: Resolution[];
  worklet?: WorkletPerfReport;
}

/** Shared hyphon_native.wasm heap for the live audio session (#1134 follow-up). */
export interface HyphonNativeHeapTelemetry {
  /** Live hyphon_native memories in the audio session. Expected: 1. */
  heapCount: number;
  initialPages: number;
  currentPages: number;
  growEvents: number;
  /** Voice processors holding handles on the shared instance. */
  voices: number;
  /** Which link profile the shared instance was built from. */
  threading: HyphonNativeThreading | 'unknown';
}

export interface RuntimeSnapshot {
  masterBudgetPercent: number;
  totalUnderruns: number;
  outputLatencyMs: number | null;
  glitches: GlitchEvent[];
  worklets: Record<string, WorkletPerfReport>;
  degradations: Array<{ step: string; active: boolean; reason: string; ts: number }>;
  /** Last offline 303 render thread count (Phase-1 / #974). */
  offlineRenderThreadCount: number | null;
  /** Last offline 303 oversample factor (1|2|4). */
  offlineRenderOversample: number | null;
  /** Last offline 303 render wall latency in ms. */
  offlineRenderLatencyMs: number | null;
  /** Last GPU 303 render latency in ms (Phase-3 / #976). */
  gpuRenderLatencyMs: number | null;
  /** Last GPU 303 readback size in bytes. */
  gpuReadbackBytes: number | null;
  /** Why GPU 303 fell back to highfid-cpu (null if GPU succeeded). */
  gpuFallbackReason: string | null;
  /** Whether last gpu-highfid render used WebGPU. */
  gpuUsedGpu: boolean | null;
  /** Whether WebGPU was available at last high-fid selection / probe. */
  gpuAvailable: boolean | null;
  /** Last requested high-fid / model303 id. */
  highFidRequested: string | null;
  /** Effective offline high-fid engine after selection fallback. */
  highFidActiveEngine: string | null;
  /** Realtime worklet model while high-fid is selected. */
  highFidRealtimeModel: string | null;
  /** Selection-time high-fid fallback reason. */
  highFidFallbackReason: string | null;
  /** Realtime 303 voice requested by the last live high-fid selection. */
  liveHighFidRequested: string | null;
  /** Whether the live diode-ladder voice is currently the audible path. */
  liveHighFidActive: boolean | null;
  /** Why the live high-fid voice stepped down to stock (null if healthy). */
  liveHighFidFallbackReason: string | null;
  /** Rolling CPU share of the quantum used by the live high-fid voice. */
  liveHighFidCpuPercent: number | null;
  /** Oversample factor the live high-fid voice runs at (1 or 2). */
  liveHighFidOversample: number | null;
  /** Live A/B requested on the last part that changed it. */
  liveAbArmed: boolean | null;
  /** Both A/B buses wired (armed and the part is on live-highfid). */
  liveAbEngaged: boolean | null;
  /** Equal-power A/B blend, 0 = stock, 1 = live high-fid. */
  liveAbMix: number | null;
  /** Rolling CPU share of the quantum used by the A/B stock side. */
  liveAbStockCpuPercent: number | null;
  /** Rolling CPU share of the quantum used by the A/B high-fid side. */
  liveAbHighFidCpuPercent: number | null;
  /** Live AudioContext.sampleRate at construction (Hz). */
  sampleRate: number | null;
  requestedSampleRate: number | null;
  sampleRateFallback: string | null;
  sinkId: string | null;
  sinkLabel: string | null;
  /** Live AudioContext.baseLatency at construction, in ms. */
  baseLatencyMs: number | null;
  /** latencyHint requested when the context was created. */
  latencyHint: string | null;
  /** renderSizeHint requested (null = omitted / unsupported by this browser). */
  renderSizeHintRequested: string | number | null;
  /** Render quantum the context actually runs at (null = not exposed; do not assume 128). */
  renderQuantumSize: number | null;
  /** Why renderSizeHint / constructor sinkId was dropped (null if honoured). */
  contextOptionFallback: string | null;
  /** Step lookahead the internal clock was given, derived from the live context's latency (ms). */
  stepLookaheadMs: number | null;
  /** MIDI transport sync telemetry (master/slave/internal). */
  transportSync: TransportSyncTelemetry | null;
  /** WAM2 host slots (Phase A compatibility spike). */
  wam2Slots: Wam2SlotTelemetry[];
  wam2Constraints: Wam2RuntimeConstraints | null;
  /** Session WebGPU probe breadcrumb (browser, reason, adapter). */
  webgpuProbe: WebGpuProbeSnapshot | null;
  /** Shared GPUDevice losses / recoveries / uncaptured errors. Absent on old reports. */
  webgpuDevice?: WebGpuDeviceTelemetry;
  /** Shared hyphon_native heap (303 + Prophecy + live high-fid); null until a voice is ready. */
  hyphonNativeHeap: HyphonNativeHeapTelemetry | null;
}

export interface EngineReport {
  version: 1;
  exportedAt: string;
  sessionDurationMs: number;
  capabilities: BrowserCapabilities;
  subsystems: Record<string, SubsystemReport>;
  runtime: RuntimeSnapshot;
}

