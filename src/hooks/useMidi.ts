// useMidi — Web MIDI API integration for live note input and step recording.
//
// Architecture:
// - `parseMidiMessage` is a pure function exported for unit testing.
// - The hook requests MIDI access on enable, listens to all connected inputs,
//   and wires note-on/off messages to the audioEngine's live note API.
// - Step recording: when `isStepRecording` is true and a note-on arrives,
//   `onStepRecord(noteString, currentStep)` is called so the parent can
//   toggle a pattern step without any MIDI-specific knowledge in the sequencer.
// - Velocity is normalised to 0–1 before forwarding (MIDI 0–127).
// - Note IDs returned by `noteOnSynth` are stored so `noteOffSynth` can
//   release the exact voice that was started. If the engine returns null
//   (engines that don't support live note-on yet), the release is a no-op.

import { useEffect, useRef, useState, useCallback } from 'react';
import type { MutableRefObject } from 'react';
import { midiToNote } from '../utils/musicTheory';
import type { AudioEngine, SynthParams } from '../types';

// ── Message types ─────────────────────────────────────────────────────────────

export type MidiMessageType = 'noteOn' | 'noteOff' | 'cc' | 'pitchBend' | 'programChange';

export interface MidiMessage {
    type: MidiMessageType;
    channel: number;  // 0-indexed (MIDI channel 1 = channel 0)
    /** MIDI note number 0-127 (noteOn / noteOff only). */
    note?: number;
    /** Raw MIDI velocity 0-127. */
    velocity?: number;
    /** CC number 0-127. */
    cc?: number;
    /** CC or program-change value. */
    value?: number;
    /** Signed pitch-bend value -8192..+8191. */
    pitchBendValue?: number;
}

/**
 * Parse a raw MIDI message byte array into a typed record.
 * Returns null for unsupported/unrecognised status bytes.
 *
 * Handles the MIDI spec quirk where note-on with velocity=0 is note-off.
 */
export function parseMidiMessage(data: Uint8Array): MidiMessage | null {
    if (!data || data.length < 2) return null;

    const status  = data[0]!;
    const cmd     = (status >> 4) & 0xF;
    const channel = status & 0xF;
    const b1      = data[1] ?? 0;
    const b2      = data[2] ?? 0;

    switch (cmd) {
        case 0x8:
            return { type: 'noteOff', channel, note: b1, velocity: b2 };
        case 0x9:
            // Note-on with velocity 0 is defined by the MIDI spec as note-off.
            return b2 === 0
                ? { type: 'noteOff', channel, note: b1, velocity: 0 }
                : { type: 'noteOn',  channel, note: b1, velocity: b2 };
        case 0xB:
            return { type: 'cc', channel, cc: b1, value: b2 };
        case 0xC:
            return { type: 'programChange', channel, value: b1 };
        case 0xE: {
            // Pitch bend: 14-bit signed, centre = 8192
            const raw = ((b2 << 7) | b1);
            return { type: 'pitchBend', channel, pitchBendValue: raw - 8192 };
        }
        default:
            return null;
    }
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export interface UseMidiOptions {
    /** Audio engine — receives live note-on/off events. */
    audioEngine: AudioEngine | null;
    /** Synth params for the active track (passed to `noteOnSynth`). */
    synthParams: SynthParams | null;
    /** Which synth track MIDI note input targets. Default 'partA'. */
    targetTrack?: 'partA' | 'partB' | 'bass2';
    /** Set true to record incoming note-ons as pattern steps. */
    isStepRecording?: boolean;
    /** Ref to the currently playing sequencer step (for step recording). */
    currentStepRef?: MutableRefObject<number>;
    /**
     * Called when a note-on arrives during step recording.
     * Parent toggles the step in the pattern without needing MIDI knowledge.
     */
    onStepRecord?: (noteString: string, step: number) => void;
    /** When false, MIDI access is not requested. Default true. */
    isEnabled?: boolean;
}

export interface UseMidiReturn {
    /** True when the browser supports `navigator.requestMIDIAccess`. */
    isSupported: boolean;
    /** True after a successful `requestMIDIAccess` call. */
    isConnected: boolean;
    /** Names of all connected MIDI input devices. */
    deviceNames: string[];
    /** Non-null when MIDI access was denied or failed. */
    error: string | null;
}

export function useMidi(options: UseMidiOptions): UseMidiReturn {
    const {
        audioEngine,
        synthParams,
        targetTrack = 'partA',
        isStepRecording = false,
        currentStepRef,
        onStepRecord,
        isEnabled = true,
    } = options;

    const [isConnected, setIsConnected]   = useState(false);
    const [deviceNames, setDeviceNames]   = useState<string[]>([]);
    const [error, setError]               = useState<string | null>(null);
    const isSupported = typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator;

    // Map from MIDI note number → note ID returned by noteOnSynth, for tracking release.
    const activeNoteIds = useRef(new Map<number, number>());

    // Stable refs so the event listener never goes stale.
    const audioEngineRef    = useRef(audioEngine);
    const synthParamsRef    = useRef(synthParams);
    const targetTrackRef    = useRef(targetTrack);
    const isStepRecordRef   = useRef(isStepRecording);
    const onStepRecordRef   = useRef(onStepRecord);

    useEffect(() => { audioEngineRef.current    = audioEngine;    }, [audioEngine]);
    useEffect(() => { synthParamsRef.current    = synthParams;    }, [synthParams]);
    useEffect(() => { targetTrackRef.current    = targetTrack;    }, [targetTrack]);
    useEffect(() => { isStepRecordRef.current   = isStepRecording;}, [isStepRecording]);
    useEffect(() => { onStepRecordRef.current   = onStepRecord;   }, [onStepRecord]);

    const handleMidiMessage = useCallback((event: Event) => {
        const midiEvent = event as MIDIMessageEvent;
        if (!midiEvent.data) return;

        const msg = parseMidiMessage(midiEvent.data);
        if (!msg) return;

        const engine = audioEngineRef.current;
        const params = synthParamsRef.current;

        if (msg.type === 'noteOn' && msg.note !== undefined) {
            const noteStr = midiToNote(msg.note);
            const velocity01 = (msg.velocity ?? 64) / 127;

            // Live note-on
            if (engine?.noteOnSynth && params) {
                const paramsWithVelocity: SynthParams = {
                    ...params,
                    volume: params.volume * velocity01,
                };
                const idOrPromise = engine.noteOnSynth(
                    paramsWithVelocity,
                    noteStr,
                    undefined,
                    targetTrackRef.current,
                    null,
                );
                // Handle both sync and async returns
                Promise.resolve(idOrPromise).then((id) => {
                    if (id !== null && id !== undefined) {
                        activeNoteIds.current.set(msg.note!, id);
                    }
                }).catch(() => {/* noop */});
            }

            // Step recording
            if (isStepRecordRef.current && currentStepRef && currentStepRef.current >= 0) {
                onStepRecordRef.current?.(noteStr, currentStepRef.current);
            }
        }

        if (msg.type === 'noteOff' && msg.note !== undefined) {
            const id = activeNoteIds.current.get(msg.note);
            if (id !== undefined && engine?.noteOffSynth) {
                engine.noteOffSynth(id);
            }
            activeNoteIds.current.delete(msg.note);
        }
    }, [currentStepRef]);

    useEffect(() => {
        if (!isEnabled || !isSupported) return;

        let midiAccess: MIDIAccess | null = null;
        const boundListeners = new Map<MIDIInput, EventListener>();

        const attachInput = (input: MIDIInput) => {
            if (boundListeners.has(input)) return;
            const listener = handleMidiMessage as EventListener;
            input.addEventListener('midimessage', listener);
            boundListeners.set(input, listener);
        };

        const detachInput = (input: MIDIInput) => {
            const listener = boundListeners.get(input);
            if (listener) {
                input.removeEventListener('midimessage', listener);
                boundListeners.delete(input);
            }
        };

        const refreshDevices = (access: MIDIAccess) => {
            const names: string[] = [];
            access.inputs.forEach((input) => {
                attachInput(input);
                names.push(input.name ?? `MIDI Input ${input.id}`);
            });
            // Detach inputs that have been removed
            boundListeners.forEach((_, input) => {
                if (!access.inputs.has(input.id)) detachInput(input);
            });
            setDeviceNames(names);
        };

        (navigator as any).requestMIDIAccess({ sysex: false })
            .then((access: MIDIAccess) => {
                midiAccess = access;
                setIsConnected(true);
                setError(null);
                refreshDevices(access);

                access.onstatechange = () => refreshDevices(access);
            })
            .catch((err: unknown) => {
                setError(err instanceof Error ? err.message : 'MIDI access denied');
                setIsConnected(false);
            });

        return () => {
            boundListeners.forEach((listener, input) => {
                input.removeEventListener('midimessage', listener);
            });
            boundListeners.clear();
            if (midiAccess) midiAccess.onstatechange = null;
        };
    }, [isEnabled, isSupported, handleMidiMessage]);

    return { isSupported, isConnected, deviceNames, error };
}
