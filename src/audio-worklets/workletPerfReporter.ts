/**
 * AudioWorklet-side process() wall-time reporter.
 * Throttles metrics to the main thread via MessagePort (~10 Hz).
 */

declare const sampleRate: number;
declare const currentFrame: number;

export const WORKLET_PERF_MSG_TYPE = 'worklet-perf' as const;

export interface WorkletPerfMessage {
  type: typeof WORKLET_PERF_MSG_TYPE;
  name: string;
  /** Rolling CPU % of quantum budget (0–100). */
  cpuPercent: number;
  /** Cumulative underrun count (process time exceeded quantum). */
  underruns: number;
  blockFrames: number;
  processUs: number;
  quantumUs: number;
}

function nowUs(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now() * 1000;
  }
  return Date.now() * 1000;
}

export class WorkletPerfReporter {
  private readonly port: MessagePort;
  private readonly name: string;
  private readonly reportIntervalFrames: number;
  private accProcessUs = 0;
  private accQuantumUs = 0;
  private accBlockFrames = 0;
  private totalUnderruns = 0;
  private lastReportFrame = 0;

  constructor(
    port: MessagePort,
    name: string,
    reportIntervalMs = 100,
  ) {
    this.port = port;
    this.name = name;
    const sr = typeof sampleRate === 'number' && sampleRate > 0 ? sampleRate : 48000;
    this.reportIntervalFrames = Math.max(128, Math.floor((sr * reportIntervalMs) / 1000));
    this.lastReportFrame = typeof currentFrame === 'number' ? currentFrame : 0;
  }

  /** Call at start of process(); invoke returned fn at end (prefer finally). */
  beginProcess(blockFrames: number): () => void {
    const t0 = nowUs();
    const sr = typeof sampleRate === 'number' && sampleRate > 0 ? sampleRate : 48000;
    const quantumUs = (blockFrames / sr) * 1_000_000;
    return () => {
      const processUs = nowUs() - t0;
      this.accProcessUs += processUs;
      this.accQuantumUs += quantumUs;
      this.accBlockFrames += blockFrames;
      if (processUs > quantumUs) {
        this.totalUnderruns += 1;
      }
      this.maybeFlush();
    };
  }

  private maybeFlush(): void {
    const frame = typeof currentFrame === 'number' ? currentFrame : 0;
    if (frame - this.lastReportFrame < this.reportIntervalFrames) return;
    this.flush(frame);
  }

  private flush(frame: number): void {
    const cpuPercent =
      this.accQuantumUs > 0
        ? Math.min(100, (this.accProcessUs / this.accQuantumUs) * 100)
        : 0;

    const msg: WorkletPerfMessage = {
      type: WORKLET_PERF_MSG_TYPE,
      name: this.name,
      cpuPercent,
      underruns: this.totalUnderruns,
      blockFrames: this.accBlockFrames,
      processUs: this.accProcessUs,
      quantumUs: this.accQuantumUs,
    };

    try {
      this.port.postMessage(msg);
    } catch {
      /* port may be closed during teardown */
    }

    this.accProcessUs = 0;
    this.accQuantumUs = 0;
    this.accBlockFrames = 0;
    this.lastReportFrame = frame;
  }
}
