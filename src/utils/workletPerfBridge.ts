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

const sampleRateFallbackRecorded = new Set<string>();

/** Live per-node slots by worklet kind, so concurrent nodes get distinct telemetry keys. */
const liveSlots = new Map<string, Set<number>>();

function claimSlot(name: string): number {
  let slots = liveSlots.get(name);
  if (!slots) {
    slots = new Set();
    liveSlots.set(name, slots);
  }
  let slot = 0;
  while (slots.has(slot)) slot++;
  slots.add(slot);
  return slot;
}

function handlePerfMessage(key: string, data: WorkletPerfMessage): void {
  if (data.sampleRateFallback && !sampleRateFallbackRecorded.has(data.name)) {
    sampleRateFallbackRecorded.add(data.name);
    engineTelemetry.recordGlitch('worklet-sample-rate-fallback', { worklet: data.name });
  }
  engineTelemetry.recordWorkletPerf(key, {
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
 *
 * Each attached node reports under its own key (`name`, then `name#1`, `name#2`, …)
 * so a pool of voices sums into the master budget rather than the last reporter
 * winning. The returned detach drops the node's telemetry and frees its slot.
 */
export function attachWorkletPerf(node: AudioWorkletNode, name: string): () => void {
  const slot = claimSlot(name);
  const key = slot === 0 ? name : `${name}#${slot}`;
  engineTelemetry.registerWorklet(key);
  const onMessage = (event: MessageEvent): void => {
    const data: unknown = event.data;
    if (!data || typeof data !== 'object') return;
    const message = data as Record<string, unknown>;
    if (message.type === WORKLET_PERF_MSG_TYPE) {
      handlePerfMessage(key, data as WorkletPerfMessage);
    } else {
      handleArtifactMessage(message);
    }
  };

  node.port.addEventListener('message', onMessage);
  let detached = false;
  return () => {
    if (detached) return;
    detached = true;
    node.port.removeEventListener('message', onMessage);
    liveSlots.get(name)?.delete(slot);
    engineTelemetry.unregisterWorklet(key);
  };
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
  renderSizeHintRequested?: string | number | null;
  renderQuantumSize?: number | null;
  contextOptionFallback?: string | null;
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
    renderSizeHintRequested: meta.renderSizeHintRequested ?? null,
    renderQuantumSize: meta.renderQuantumSize ?? null,
    contextOptionFallback: meta.contextOptionFallback ?? null,
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
