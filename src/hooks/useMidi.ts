import { useEffect, useRef } from 'react';
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
 * Independent of gamepad / keyboard — uses navigator.requestMIDIAccess only.
 */
export function useMidi({ handlers, showToast }: UseMidiOptions): void {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('requestMIDIAccess' in navigator)) {
      midiMapStore.setInputAvailable(false);
      return;
    }

    let disposed = false;
    const inputHandlers = new Map<MIDIInput, (e: MIDIMessageEvent) => void>();

    const attachInput = (input: MIDIInput) => {
      if (inputHandlers.has(input)) return;
      const handler = (e: MIDIMessageEvent) => {
        const data = e.data;
        if (!data) return;
        handleRawMidiMessage(data, input.id || undefined, handlersRef.current, showToast);
      };
      inputHandlers.set(input, handler);
      input.onmidimessage = handler;
    };

    const detachInput = (input: MIDIInput) => {
      const handler = inputHandlers.get(input);
      if (handler) {
        input.onmidimessage = null;
        inputHandlers.delete(input);
      }
    };

    const refreshInputs = (access: MIDIAccess) => {
      const inputs = Array.from(access.inputs.values());
      inputs.forEach(attachInput);
      midiMapStore.setInputAvailable(
        inputs.length > 0,
        inputs.map((i) => i.name || i.id || 'MIDI Input'),
      );
    };

    const onStateChange = (e: MIDIConnectionEvent) => {
      if (disposed || !midiAccess) return;
      const port = e.port;
      if (!port || port.type !== 'input') return;
      if (port.state === 'connected') {
        attachInput(port as MIDIInput);
      } else {
        detachInput(port as MIDIInput);
      }
      refreshInputs(midiAccess);
    };

    let midiAccess: MIDIAccess | null = null;

    navigator.requestMIDIAccess({ sysex: false })
      .then((access) => {
        if (disposed) return;
        midiAccess = access;
        access.onstatechange = onStateChange;
        refreshInputs(access);
      })
      .catch(() => {
        midiMapStore.setInputAvailable(false);
      });

    return () => {
      disposed = true;
      inputHandlers.forEach((_, input) => detachInput(input));
      if (midiAccess) midiAccess.onstatechange = null;
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
