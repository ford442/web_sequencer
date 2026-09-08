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
  private readonly cachedSampleRate: number;
  private accProcessUs = 0;
  private accQuantumUs = 0;
  private accBlockFrames = 0;
  private totalUnderruns = 0;
  private lastReportFrame = 0;

  // Bolt Optimization: Instance fields to prevent closure allocations
  private t0 = 0;
  private blockFrames = 0;
  private quantumUs = 0;

  // Bolt Optimization: Pre-allocate message to prevent GC
  private readonly msg: WorkletPerfMessage;

  constructor(
    port: MessagePort,
    name: string,
    reportIntervalMs = 100,
  ) {
    this.port = port;
    this.name = name;
    this.cachedSampleRate = typeof sampleRate === 'number' && sampleRate > 0 ? sampleRate : 48000;
    this.reportIntervalFrames = Math.max(128, Math.floor((this.cachedSampleRate * reportIntervalMs) / 1000));
    this.lastReportFrame = typeof currentFrame === 'number' ? currentFrame : 0;

    this.msg = {
      type: WORKLET_PERF_MSG_TYPE,
      name: this.name,
      cpuPercent: 0,
      underruns: 0,
      blockFrames: 0,
      processUs: 0,
      quantumUs: 0,
    };
  }

  /** Call at start of process(); invoke endProcess() at end (prefer finally). */
  beginProcess(blockFrames: number): void {
    this.t0 = nowUs();
    this.blockFrames = blockFrames;
    this.quantumUs = (blockFrames / this.cachedSampleRate) * 1_000_000;
  }

  endProcess(): void {
    const processUs = nowUs() - this.t0;
    this.accProcessUs += processUs;
    this.accQuantumUs += this.quantumUs;
    this.accBlockFrames += this.blockFrames;
    if (processUs > this.quantumUs) {
      this.totalUnderruns += 1;
    }
    this.maybeFlush();
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

    this.msg.cpuPercent = cpuPercent;
    this.msg.underruns = this.totalUnderruns;
    this.msg.blockFrames = this.accBlockFrames;
    this.msg.processUs = this.accProcessUs;
    this.msg.quantumUs = this.accQuantumUs;

    try {
      this.port.postMessage(this.msg);
    } catch {
      /* port may be closed during teardown */
    }

    this.accProcessUs = 0;
    this.accQuantumUs = 0;
    this.accBlockFrames = 0;
    this.lastReportFrame = frame;
  }
}
