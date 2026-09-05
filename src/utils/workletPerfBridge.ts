/**
 * Main-thread bridge: attach to AudioWorkletNode ports, feed engineTelemetry,
 * run glitch detection (context state, output latency spikes, artifact detector).
 */

import type { WorkletPerfMessage } from '@/audio-worklets/workletPerfReporter';
import { WORKLET_PERF_MSG_TYPE } from '@/audio-worklets/workletPerfReporter';
import { engineTelemetry } from '@/utils/engineTelemetry';
import { performanceBudget } from '@/utils/performanceBudget';

const LATENCY_SPIKE_MS = 20;
const GLITCH_POLL_MS = 250;

let glitchMonitorStarted = false;
let glitchPollTimer: ReturnType<typeof setInterval> | null = null;
let lastOutputLatencyMs: number | null = null;
let monitoredContext: AudioContext | null = null;

function handlePerfMessage(data: WorkletPerfMessage): void {
  engineTelemetry.recordWorkletPerf(data.name, {
    cpuPercent: data.cpuPercent,
    underruns: data.underruns,
    processUs: data.processUs,
    quantumUs: data.quantumUs,
    blockFrames: data.blockFrames,
  });
  performanceBudget.evaluate();
}

function handleArtifactMessage(data: Record<string, unknown>): void {
  if (data.type === 'artifact-detected') {
    engineTelemetry.recordGlitch('artifact', {
      severity: data.detection && typeof data.detection === 'object'
        ? (data.detection as { severity?: number }).severity
        : undefined,
    });
  } else if (data.type === 'quality-update') {
    const rate = typeof data.artifactRate === 'number' ? data.artifactRate : 0;
    if (rate > 0.05) {
      engineTelemetry.recordGlitch('artifact-rate', { artifactRate: rate });
    }
  }
}

/**
 * Attach perf + artifact listeners to a worklet node's MessagePort.
 * Safe to call alongside existing port.onmessage handlers (uses addEventListener).
 */
export function attachWorkletPerf(node: AudioWorkletNode, name: string): () => void {
  engineTelemetry.registerWorklet(name);

  const onMessage = (event: MessageEvent): void => {
    const data: unknown = event.data;
    if (!data || typeof data !== 'object') return;
    const message = data as Record<string, unknown>;
    if (message.type === WORKLET_PERF_MSG_TYPE) {
      handlePerfMessage(data as WorkletPerfMessage);
    } else {
      handleArtifactMessage(message);
    }
  };

  node.port.addEventListener('message', onMessage);
  return () => node.port.removeEventListener('message', onMessage);
}

function onContextStateChange(): void {
  if (!monitoredContext) return;
  if (monitoredContext.state !== 'running') {
    engineTelemetry.recordGlitch('context-state', { state: monitoredContext.state });
  }
}

function pollOutputLatency(): void {
  if (!monitoredContext) return;
  const latencyMs =
  (monitoredContext.outputLatency + (monitoredContext.baseLatency ?? 0)) * 1000;
  engineTelemetry.recordOutputLatency(latencyMs);

  if (lastOutputLatencyMs !== null) {
    const delta = Math.abs(latencyMs - lastOutputLatencyMs);
    if (delta >= LATENCY_SPIKE_MS) {
      engineTelemetry.recordGlitch('latency-spike', {
        fromMs: lastOutputLatencyMs,
        toMs: latencyMs,
        deltaMs: delta,
      });
    }
  }
  lastOutputLatencyMs = latencyMs;
}

export interface GlitchMonitorMeta {
  latencyHint?: string | null;
  requestedSampleRate?: number | null;
  sampleRateFallback?: string | null;
}

/** Start monitoring AudioContext state + output latency (idempotent). */
export function startGlitchMonitor(
  context: AudioContext,
  latencyHintOrMeta?: string | null | GlitchMonitorMeta,
): void {
  if (glitchMonitorStarted && monitoredContext === context) return;
  stopGlitchMonitor();

  monitoredContext = context;
  glitchMonitorStarted = true;
  lastOutputLatencyMs = null;

  const meta: GlitchMonitorMeta =
    latencyHintOrMeta && typeof latencyHintOrMeta === 'object'
      ? latencyHintOrMeta
      : { latencyHint: latencyHintOrMeta ?? null };

  engineTelemetry.recordAudioContextInfo({
    sampleRate: context.sampleRate,
    requestedSampleRate: meta.requestedSampleRate ?? null,
    sampleRateFallback: meta.sampleRateFallback ?? null,
    baseLatencyMs: (context.baseLatency ?? 0) * 1000,
    latencyHint: meta.latencyHint ?? null,
  });

  context.addEventListener('statechange', onContextStateChange);
  pollOutputLatency();

  glitchPollTimer = setInterval(pollOutputLatency, GLITCH_POLL_MS);
}

export function stopGlitchMonitor(): void {
  if (monitoredContext) {
    monitoredContext.removeEventListener('statechange', onContextStateChange);
  }
  if (glitchPollTimer) {
    clearInterval(glitchPollTimer);
    glitchPollTimer = null;
  }
  monitoredContext = null;
  glitchMonitorStarted = false;
  lastOutputLatencyMs = null;
}

/** Register rubberband worklet nodes for auto quality reduction. */
export function registerRubberbandNode(node: AudioWorkletNode): () => void {
  return performanceBudget.registerRubberbandHandler((profile) => {
    node.port.postMessage({ type: 'setStretchProfile', data: { profile } });
  });
}
