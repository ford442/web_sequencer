import { afterEach, describe, expect, it, vi } from 'vitest';
import { engineTelemetry } from '../../../utils/engineTelemetry';
import { engineDegradationStore } from '../../../stores/engineDegradationStore';
import { VOCAL_FX_SUBSYSTEM, readVocalFxOverride, recordVocalFxBackend } from '../vocalFxTelemetry';

afterEach(() => {
  engineDegradationStore.clear('vocal-fx-native');
  vi.restoreAllMocks();
});

const resolution = () => engineTelemetry.snapshot()[VOCAL_FX_SUBSYSTEM]?.resolution;

describe('recordVocalFxBackend', () => {
  it('records native as the resolved backend with no degradation', () => {
    recordVocalFxBackend({ backend: 'native' });
    expect(resolution()).toMatchObject({ backend: 'native' });
    expect(engineDegradationStore.getIssue('vocal-fx-native')).toBeUndefined();
  });

  it('surfaces an unrequested TS fallback in console, telemetry and the degradation store', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    recordVocalFxBackend({ backend: 'ts', reason: 'rubberband.wasm has no rb_fx_* exports' });

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('no rb_fx_* exports'));
    expect(resolution()).toMatchObject({ backend: 'ts-fallback', reason: 'rubberband.wasm has no rb_fx_* exports' });
    expect(engineTelemetry.getRuntimeSnapshot().degradations).toContainEqual(
      expect.objectContaining({ step: VOCAL_FX_SUBSYSTEM, active: true }),
    );
    expect(engineDegradationStore.getIssue('vocal-fx-native')).toMatchObject({
      status: 'active',
      activeBackend: 'ts',
      requestedBackend: 'native',
    });

    recordVocalFxBackend({ backend: 'native' });
    expect(engineDegradationStore.getIssue('vocal-fx-native')?.status).toBe('resolved');
  });

  it('does not raise a degradation for an explicit ?vocalFx=ts', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    recordVocalFxBackend({ backend: 'ts', reason: 'forced by fxBackend=ts' }, true);
    expect(resolution()).toMatchObject({ backend: 'ts' });
    expect(engineDegradationStore.getIssue('vocal-fx-native')).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('readVocalFxOverride', () => {
  it('only accepts vocalFx=ts', () => {
    expect(readVocalFxOverride('?vocalFx=ts&hud=1')).toBe('ts');
    expect(readVocalFxOverride('?vocalFx=native')).toBeUndefined();
    expect(readVocalFxOverride('')).toBeUndefined();
  });
});
