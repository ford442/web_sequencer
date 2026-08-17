import type { AutomationTarget } from '../types';
import type { MidiControlId } from '../types/midi';
import { parseMidiControlId } from '../types/midi';
import { automationStore } from '../stores/automationStore';

export interface MidiParamHandlers {
  handleSynthChange: (isA: boolean, id: string, val: number) => void;
  handleBass2Change: (id: string, val: number) => void;
  handleKickChange: (id: string, val: number) => void;
  handleSnareChange: (id: string, val: number) => void;
  handleClosedHatChange: (id: string, val: number) => void;
  handleOpenHatChange: (id: string, val: number) => void;
  handleSamplerChange: (id: string, val: number) => void;
  setMasterVolume: (v: number) => void;
  setMasterSaturation: (v: number) => void;
  setGlobalPan: (v: number) => void;
  setAudioMasterVolume?: (v: number) => void;
  setAudioMasterSaturation?: (v: number) => void;
  setAudioGlobalPan?: (v: number) => void;
  getCurrentStep?: () => number;
  handleSessionControl?: (param: string, normalized: number) => void;
}

/** Map normalized 0–1 MIDI value to control-specific range, then dispatch. */
export function applyMidiControlValue(
  controlId: MidiControlId,
  normalized: number,
  handlers: MidiParamHandlers,
): void {
  const { target, param } = parseMidiControlId(controlId);
  const n = Math.max(0, Math.min(1, normalized));

  if (target === 'session') {
    handlers.handleSessionControl?.(param, n);
    return;
  }

  if (target === 'master') {
    applyMasterParam(param, n, handlers);
    return;
  }

  applyTrackParam(target, param, n, handlers);
}

function applyMasterParam(param: string, n: number, handlers: MidiParamHandlers): void {
  const step = handlers.getCurrentStep?.() ?? 0;
  if (param === 'volume') {
    const v = n * 1.5;
    handlers.setMasterVolume(v);
    handlers.setAudioMasterVolume?.(v);
    if (automationStore.isParameterArmed('master', 'volume')) {
      automationStore.recordPoint('master', 'volume', { step, value: Math.max(0, Math.min(1, v)) });
    }
  } else if (param === 'saturation') {
    handlers.setMasterSaturation(n);
    handlers.setAudioMasterSaturation?.(n);
  } else if (param === 'pan') {
    const p = n * 2 - 1;
    const val = p > -0.1 && p < 0.1 ? 0 : p;
    handlers.setGlobalPan(val);
    handlers.setAudioGlobalPan?.(val);
  }
}

function applyTrackParam(
  target: AutomationTarget,
  param: string,
  n: number,
  handlers: MidiParamHandlers,
): void {
  switch (target) {
    case 'synthA':
      handlers.handleSynthChange(true, param, n);
      break;
    case 'synthB':
      handlers.handleSynthChange(false, param, n);
      break;
    case 'bass2':
      handlers.handleBass2Change(param, n);
      break;
    case 'kick':
      handlers.handleKickChange(param, n);
      break;
    case 'snare':
      handlers.handleSnareChange(param, n);
      break;
    case 'closedHat':
      handlers.handleClosedHatChange(param, n);
      break;
    case 'openHat':
      handlers.handleOpenHatChange(param, n);
      break;
    case 'sampler':
      handlers.handleSamplerChange(param, n);
      break;
    default:
      break;
  }
}
