import { useEffect, useRef } from 'react';
import { midiPortManager } from '../midi/MidiPortManager';
import { midiMapStore } from '../stores/midiMapStore';
import type { AutomationTarget } from '../types';
import type { MidiBinding } from '../types/midi';
import { formatMidiBindingLabel, makeMidiControlId, midiValueToNormalized } from '../types/midi';
import { applyMidiControlValue, type MidiParamHandlers } from '../utils/midiParamDispatch';
import { midiMessageToBinding, parseMidiMessage } from '../utils/midiMessageParse';

export { parseMidiMessage } from '../utils/midiMessageParse';

export interface UseMidiOptions {
  handlers: MidiParamHandlers;
  showToast?: (message: string, type: 'success' | 'error' | 'info') => void;
}

function handleRawMidiMessage(
  data: Uint8Array,
  deviceId: string | undefined,
  handlers: MidiParamHandlers,
  showToast?: (message: string, type: 'success' | 'error' | 'info') => void,
): void {
  const parsed = parseMidiMessage(data);
  if (!parsed) return;
  const bindingInput = midiMessageToBinding(parsed);
  if (!bindingInput) return;

  const { key, value } = bindingInput;
  const state = midiMapStore.getState();

  if (state.learnMode && state.lastTouchedControl) {
    const binding: MidiBinding = {
      key,
      controlId: state.lastTouchedControl,
      deviceId: deviceId || undefined,
    };
    midiMapStore.addBinding(binding);
    midiMapStore.setLearnMode(false);
    showToast?.(
      `MIDI: ${formatMidiBindingLabel(key)} → ${state.lastTouchedControl}`,
      'success',
    );
    applyMidiControlValue(state.lastTouchedControl, midiValueToNormalized(value), handlers);
    midiMapStore.flashControl(state.lastTouchedControl);
    return;
  }

  const binding = midiMapStore.findBinding(key, deviceId);
  if (!binding) return;

  const normalized = midiValueToNormalized(value);
  applyMidiControlValue(binding.controlId, normalized, handlers);
  midiMapStore.flashControl(binding.controlId);
}

/**
 * Web MIDI input: learn mode, mapping persistence, and live CC routing.
 * Uses shared MidiPortManager — channel messages only (clock routed separately).
 */
export function useMidi({ handlers, showToast }: UseMidiOptions): void {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    const refreshInputs = () => {
      const inputs = midiPortManager.getInputs();
      midiMapStore.setInputAvailable(
        inputs.length > 0,
        inputs.map((i) => i.name),
      );
    };

    const unsubChannel = midiPortManager.onChannelMessage((deviceId, data) => {
      handleRawMidiMessage(data, deviceId || undefined, handlersRef.current, showToast);
    });

    const unsubState = midiPortManager.onStateChange(refreshInputs);

    void midiPortManager.ensureAccess().then((access) => {
      if (access) refreshInputs();
      else midiMapStore.setInputAvailable(false);
    });

    return () => {
      unsubChannel();
      unsubState();
    };
  }, [showToast]);
}

/** Register a control touch for MIDI learn (knob drag, slider focus, long-press). */
export function registerMidiControlTouch(target: AutomationTarget, param: string): void {
  midiMapStore.touchControl(makeMidiControlId(target, param));
}

/** Long-press on a control: arm learn mode for that parameter. */
export function startMidiLearnForControl(target: AutomationTarget, param: string): void {
  midiMapStore.touchControl(makeMidiControlId(target, param));
  midiMapStore.setLearnMode(true);
}
