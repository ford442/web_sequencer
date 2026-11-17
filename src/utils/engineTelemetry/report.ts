// Report serialization + download. The pure logic stays DOM-free; the browser
// download is injected through DownloadProvider.

import type { BrowserCapabilities } from './capabilities';
import type { EngineReport, RuntimeSnapshot, SubsystemReport } from './types';

// ── Download abstraction (injectable so the pure logic stays DOM-free/testable) ─

export interface DownloadProvider {
  triggerDownload(json: string, filename: string): void;
}

export const browserDownloadProvider: DownloadProvider = {
  triggerDownload(json: string, filename: string) {
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    try {
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } finally {
      // Revoke after the click has been processed by the event loop.
      setTimeout(() => URL.revokeObjectURL(url), 0);
    }
  },
};

export function reportFilename(now: Date = new Date()): string {
  return `hyphon-engine-report-${now.toISOString().replace(/[:.]/g, '-')}.json`;
}

/**
 * Pure serialization of a telemetry snapshot + capability snapshot into a report
 * JSON string. No DOM, no globals beyond Date/performance — unit-testable directly.
 */
export function serializeEngineReport(
  snapshot: Record<string, SubsystemReport>,
  capabilities: BrowserCapabilities,
  runtime: RuntimeSnapshot,
): string {
  const report: EngineReport = {
    version: 1,
    exportedAt: new Date().toISOString(),
    sessionDurationMs: typeof performance !== 'undefined' ? Math.round(performance.now()) : 0,
    capabilities,
    subsystems: snapshot,
    runtime,
  };
  return JSON.stringify(report, null, 2);
}
