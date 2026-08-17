import { describe, it, expect, vi } from 'vitest';
import { applyMidiControlValue } from '../midiParamDispatch';
import { makeMidiControlId } from '../../types/midi';
import { automationStore } from '../../stores/automationStore';

describe('midiParamDispatch', () => {
  it('routes synthA params through handleSynthChange', () => {
    const handleSynthChange = vi.fn();
    applyMidiControlValue(makeMidiControlId('synthA', 'decay'), 0.5, {
      handleSynthChange,
      handleBass2Change: vi.fn(),
      handleKickChange: vi.fn(),
      handleSnareChange: vi.fn(),
      handleClosedHatChange: vi.fn(),
      handleOpenHatChange: vi.fn(),
      handleSamplerChange: vi.fn(),
      setMasterVolume: vi.fn(),
      setMasterSaturation: vi.fn(),
      setGlobalPan: vi.fn(),
    });
    expect(handleSynthChange).toHaveBeenCalledWith(true, 'decay', 0.5);
  });

  it('maps master volume to 0–1.5 range', () => {
    const setMasterVolume = vi.fn();
    applyMidiControlValue(makeMidiControlId('master', 'volume'), 1, {
      handleSynthChange: vi.fn(),
      handleBass2Change: vi.fn(),
      handleKickChange: vi.fn(),
      handleSnareChange: vi.fn(),
      handleClosedHatChange: vi.fn(),
      handleOpenHatChange: vi.fn(),
      handleSamplerChange: vi.fn(),
      setMasterVolume,
      setMasterSaturation: vi.fn(),
      setGlobalPan: vi.fn(),
    });
    expect(setMasterVolume).toHaveBeenCalledWith(1.5);
  });

  it('records automation when master volume is armed and recording', () => {
    automationStore.armParameter('master', 'volume');
    automationStore.startRecording('master', 'volume');
    const setMasterVolume = vi.fn();
    applyMidiControlValue(makeMidiControlId('master', 'volume'), 0.5, {
      handleSynthChange: vi.fn(),
      handleBass2Change: vi.fn(),
      handleKickChange: vi.fn(),
      handleSnareChange: vi.fn(),
      handleClosedHatChange: vi.fn(),
      handleOpenHatChange: vi.fn(),
      handleSamplerChange: vi.fn(),
      setMasterVolume,
      setMasterSaturation: vi.fn(),
      setGlobalPan: vi.fn(),
      getCurrentStep: () => 4,
    });
    expect(setMasterVolume).toHaveBeenCalled();
    const buf = automationStore.getState().recordingBuffers.find(
      (b) => b.target === 'master' && b.parameter === 'volume',
    );
    expect(buf?.points.length).toBeGreaterThan(0);
    automationStore.reset();
  });

  it('routes session clip launches', () => {
    const handleSessionControl = vi.fn();
    applyMidiControlValue(makeMidiControlId('session', 'clip:kick:0'), 1, {
      handleSynthChange: vi.fn(),
      handleBass2Change: vi.fn(),
      handleKickChange: vi.fn(),
      handleSnareChange: vi.fn(),
      handleClosedHatChange: vi.fn(),
      handleOpenHatChange: vi.fn(),
      handleSamplerChange: vi.fn(),
      setMasterVolume: vi.fn(),
      setMasterSaturation: vi.fn(),
      setGlobalPan: vi.fn(),
      handleSessionControl,
    });
    expect(handleSessionControl).toHaveBeenCalledWith('clip:kick:0', 1);
  });
});
