import { describe, expect, it, vi } from 'vitest';
import * as facade from '../../engineTelemetry';
import * as capabilities from '../capabilities';
import * as collector from '../collector';
import * as exportMap from '../exportMap';
import * as fallback from '../fallbackReporting';
import * as report from '../report';
import { engineDegradationStore } from '../../../stores/engineDegradationStore';

describe('engineTelemetry facade', () => {
  it('re-exports the single owner of each concern', () => {
    expect(facade.engineTelemetry).toBe(collector.engineTelemetry);
    expect(facade.EngineTelemetry).toBe(collector.EngineTelemetry);
    expect(facade.getBrowserCapabilities).toBe(capabilities.getBrowserCapabilities);
    expect(facade.isAppleWebKit).toBe(capabilities.isAppleWebKit);
    expect(facade.serializeEngineReport).toBe(report.serializeEngineReport);
    expect(facade.loadHyphonWasmExportMap).toBe(exportMap.loadHyphonWasmExportMap);
    expect(facade.logEngineFallback).toBe(fallback.logEngineFallback);
  });
});

describe('fallback reporting resilience', () => {
  it('never throws into audio init when the degradation store fails', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(engineDegradationStore, 'reportEngineFallback').mockImplementation(() => {
      throw new Error('store down');
    });
    vi.spyOn(engineDegradationStore, 'report').mockImplementation(() => {
      throw new Error('store down');
    });
    expect(() => fallback.logEngineFallback('boundary-test', 'wasm', 'boom', new Error('x'))).not.toThrow();
    expect(() => fallback.logWaveformSubstitution('boundary-test', 'b', 'tri', 'saw', 'r')).not.toThrow();
    fallback.clearEngineFallbackWarning('boundary-test');
    vi.restoreAllMocks();
  });
});
