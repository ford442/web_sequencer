import { expect } from 'vitest';
import { engineTelemetry } from '@/utils/engineTelemetry';
import { engineDegradationStore } from '@/stores/engineDegradationStore';

type BackendKind = 'wasm' | 'js-fallback' | 'webgpu' | 'rust-wasm' | string;

/**
 * Assert the telemetry resolution for a subsystem matches the expected backend.
 */
export function expectActiveBackend(subsystem: string, expected: BackendKind): void {
  const snap = engineTelemetry.snapshot();
  const report = snap[subsystem];
  const history = report?.resolutionHistory ?? [];
  const latest = history[history.length - 1] ?? report?.resolution;
  const issues = engineDegradationStore.getIssues().filter(
    (i) =>
      i.subsystem === subsystem ||
      i.message?.toLowerCase().includes(subsystem.toLowerCase()),
  );

  const activeFromStore = issues.find((i) => i.activeBackend)?.activeBackend;
  const resolved = activeFromStore ?? latest?.backend;

  expect(
    resolved,
    `Expected backend "${expected}" for ${subsystem}, got ${String(resolved)} (issues: ${JSON.stringify(issues)})`,
  ).toBe(expected);
}

/**
 * Fail when a subsystem fell back to JS or logged a degradation issue.
 */
export function expectNotFallback(subsystem: string): void {
  const issues = engineDegradationStore.getIssues().filter(
    (i) =>
      i.subsystem === subsystem ||
      i.message?.toLowerCase().includes(subsystem.toLowerCase()),
  );

  const fallbackIssue = issues.find(
    (i) =>
      i.activeBackend === 'js-fallback' ||
      /fallback/i.test(i.message ?? '') ||
      /js fallback/i.test(i.message ?? ''),
  );

  expect(
    fallbackIssue,
    `Unexpected fallback for ${subsystem}: ${JSON.stringify(fallbackIssue ?? issues)}`,
  ).toBeUndefined();
}

/**
 * Assert an engine object reports ready and not on fallback path.
 */
export function expectEngineReady(
  engine: { isReady?: boolean; isFallback?: boolean },
  label: string,
): void {
  expect(engine.isReady, `${label} should be ready`).toBe(true);
  if ('isFallback' in engine) {
    expect(engine.isFallback, `${label} should not be on fallback`).toBe(false);
  }
}
