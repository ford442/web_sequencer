import type { MutableRefObject } from 'react';
import type {
    AudioEngine,
    DrumSound,
    HatParams,
    KickParams,
    SamplerBankParams,
    SnareParams,
    SynthParams,
} from '../../types';
import { noteToMidi } from '../../utils/musicTheory';
import { Harmonizer, type HarmonizerConfig } from '../../engines/Harmonizer';
import { Open303Manager } from '../../engines/Open303Manager';
import { VoiceManager } from '../../engines/VoiceManager';
import { SingingVoiceManager } from '../../engines/SingingVoiceManager';
import { makeDistortionCurve } from './distortion';

export type SynthTrack = 'partA' | 'partB' | 'bass2';
export interface SynthNoteParams {
    timbre?: number;
    microtiming?: number;
    retrigger?: number;
    filterCutoff?: number;
    filterResonance?: number;
    envMod?: number;
}

export interface DrumNoteParams {
    retrigger?: number;
}

export type PlaySynthFn = (
    params: SynthParams,
    note: string | string[],
    time: number,
    durationSteps?: number,
    stepTime?: number,
    slideFromFreq?: number,
    track?: SynthTrack,
    noteParams?: SynthNoteParams,
) => void;

export type NoteOnSynthFn = (
    params: SynthParams,
    note: string,
    time?: number,
    track?: SynthTrack,
) => number | null;

interface ActiveSynthNote {
    stop: () => void;
}

interface ActiveSamplerNote {
    source: AudioBufferSourceNode;
    envGain: GainNode;
}

export interface PlaybackRefs {
    masterGainRef: MutableRefObject<GainNode | null>;
    masterSaturationRef: MutableRefObject<WaveShaperNode | null>;
    reverbNodeRef: MutableRefObject<ConvolverNode | null>;
    masterPannerRef: MutableRefObject<StereoPannerNode | null>;
    noiseBufferRef: MutableRefObject<AudioBuffer | null>;
    open303ManagerRef: MutableRefObject<Open303Manager | null>;
    voiceManagerARef: MutableRefObject<VoiceManager | null>;
    voiceManagerBRef: MutableRefObject<VoiceManager | null>;
    nextSynthNoteId: MutableRefObject<number>;
    activeSynthNotes: MutableRefObject<Map<number, ActiveSynthNote>>;
    activeSamplerNotes: MutableRefObject<Map<number, ActiveSamplerNote>>;
    ambianceSourceNodeRef: MutableRefObject<AudioBufferSourceNode | null>;
    ambianceGainNodeRef: MutableRefObject<GainNode | null>;
    loadedAmbianceBuffersRef: MutableRefObject<Map<string, AudioBuffer>>;
    singingVoiceManagerRef: MutableRefObject<SingingVoiceManager | null>;
    harmonizerRef: MutableRefObject<Harmonizer | null>;
}

export function createPlaySynth(
    context: AudioContext,
    refs: Pick<PlaybackRefs, 'masterGainRef' | 'open303ManagerRef' | 'voiceManagerARef' | 'voiceManagerBRef'>,
): PlaySynthFn {
    return (params, note, time, durationSteps = 1, stepTime = 0.2, slideFromFreq, track, noteParams) => {
        if (!refs.masterGainRef.current) {
            return;
        }

        const actualTime = time + (noteParams?.microtiming ? noteParams.microtiming * stepTime : 0);
        let effectiveParams = params;
        if (noteParams?.timbre !== undefined || noteParams?.envMod !== undefined || noteParams?.filterCutoff !== undefined || noteParams?.filterResonance !== undefined) {
            effectiveParams = { ...params };

            if (noteParams?.timbre !== undefined) {
                const mod = 0.5 + noteParams.timbre;
                effectiveParams.filterCutoff = Math.min(20000, params.filterCutoff * mod);
            }
            if (noteParams?.filterCutoff !== undefined) {
                effectiveParams.filterCutoff = Math.max(20, noteParams.filterCutoff * 20000);
            }
            if (noteParams?.filterResonance !== undefined) {
                effectiveParams.filterResonance = noteParams.filterResonance * 20;
            }
            if (noteParams?.envMod !== undefined) {
                // @ts-expect-error envMod may not exist on SynthParams directly, but gets mapped correctly to Bass2/Open303 overrides
                effectiveParams.envMod = noteParams.envMod;
            }
        }

        const retrigger = Math.max(1, Math.floor(noteParams?.retrigger || 1));
        const subDurationSteps = durationSteps / retrigger;
        const subDuration = subDurationSteps * stepTime;

        for (let i = 0; i < retrigger; i++) {
            const noteTime = actualTime + (i * subDuration);

            if (track === 'bass2') {
                if (refs.open303ManagerRef.current?.isBass2Ready()) {
                    const noteStr = Array.isArray(note) ? note[0] : note;
                    if (!noteStr) {
                        continue;
                    }

                    const midi = noteToMidi(noteStr);
                    const now = context.currentTime;
                    const startDelay = Math.max(0, noteTime - now);
                    const noteDuration = subDuration;

                    setTimeout(() => {
                        refs.open303ManagerRef.current?.noteOnBass2(midi, 100);
                    }, startDelay * 1000);

                    setTimeout(() => {
                        if (slideFromFreq === undefined) {
                            refs.open303ManagerRef.current?.noteOffBass2(midi);
                        }
                    }, (startDelay + noteDuration) * 1000);
                }
                continue;
            }

            if (track === 'partB' && (params.waveform === '303-saw' || params.waveform === '303-sqr')) {
                if (refs.open303ManagerRef.current?.isBass1Ready()) {
                    refs.open303ManagerRef.current.applyBass1Params(effectiveParams, params.waveform === '303-sqr' ? 'sqr' : 'saw');

                    const noteStr = Array.isArray(note) ? note[0] : note;
                    if (!noteStr) {
                        continue;
                    }

                    const midi = noteToMidi(noteStr);
                    const now = context.currentTime;
                    const startDelay = Math.max(0, noteTime - now);
                    const noteDuration = subDuration;

                    setTimeout(() => {
                        refs.open303ManagerRef.current?.noteOnBass1(midi, 100);
                    }, startDelay * 1000);

                    setTimeout(() => {
                        if (slideFromFreq === undefined) {
                            refs.open303ManagerRef.current?.noteOffBass1(midi);
                        }
                    }, (startDelay + noteDuration) * 1000);

                    continue;
                }
            }

            const noteDuration = subDuration;
            const effectiveSlide = i === 0 ? slideFromFreq : undefined;

            if (track === 'partB' && refs.voiceManagerBRef.current) {
                refs.voiceManagerBRef.current.playNote(effectiveParams, note, noteTime, noteDuration, effectiveSlide);
            } else if (refs.voiceManagerARef.current) {
                refs.voiceManagerARef.current.playNote(effectiveParams, note, noteTime, noteDuration, effectiveSlide);
            }
        }
    };
}

export function createPlayDrum(
    context: AudioContext,
    refs: Pick<PlaybackRefs, 'masterGainRef' | 'noiseBufferRef'>,
): AudioEngine['playDrum'] {
    return (sound, params, time, noteParams, stepTime = 0.125) => {
        if (!refs.masterGainRef.current) {
            return;
        }

        const retrigger = Math.max(1, Math.floor(noteParams?.retrigger || 1));
        const subStep = stepTime / retrigger;

        for (let i = 0; i < retrigger; i++) {
            const now = time + (i * subStep);

            if (sound === 'kick') {
                const kickParams = params as KickParams;
                const osc = context.createOscillator();
                const gain = context.createGain();

                osc.frequency.setValueAtTime(150, now);
                osc.frequency.exponentialRampToValueAtTime(0.01, now + kickParams.decay);

                gain.gain.setValueAtTime(kickParams.volume, now);
                gain.gain.exponentialRampToValueAtTime(0.001, now + kickParams.decay);

                osc.connect(gain);

                let finalDest: AudioNode = gain;
                if (kickParams.pan !== undefined && kickParams.pan !== 0) {
                    const panner = context.createStereoPanner();
                    panner.pan.value = kickParams.pan;
                    finalDest.connect(panner);
                    finalDest = panner;
                }
                finalDest.connect(refs.masterGainRef.current);

                osc.start(now);
                osc.stop(now + kickParams.decay);
            } else if (sound === 'snare') {
                const snareParams = params as SnareParams;
                const osc = context.createOscillator();
                const oscGain = context.createGain();
                osc.type = 'triangle';
                osc.frequency.setValueAtTime(250, now);
                oscGain.gain.setValueAtTime(snareParams.tone * snareParams.volume, now);
                oscGain.gain.exponentialRampToValueAtTime(0.001, now + snareParams.decay);

                let finalDestOsc: AudioNode = oscGain;
                if (snareParams.pan !== undefined && snareParams.pan !== 0) {
                    const panner = context.createStereoPanner();
                    panner.pan.value = snareParams.pan;
                    finalDestOsc.connect(panner);
                    finalDestOsc = panner;
                }

                if (refs.noiseBufferRef.current) {
                    const noise = context.createBufferSource();
                    noise.buffer = refs.noiseBufferRef.current;
                    const noiseFilter = context.createBiquadFilter();
                    noiseFilter.type = 'highpass';
                    noiseFilter.frequency.value = 1000;
                    const noiseGain = context.createGain();
                    noiseGain.gain.setValueAtTime(snareParams.noise * snareParams.volume, now);
                    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + snareParams.decay);

                    noise.connect(noiseFilter);
                    noiseFilter.connect(noiseGain);
                    let finalDestNoise: AudioNode = noiseGain;
                    if (snareParams.pan !== undefined && snareParams.pan !== 0) {
                        const panner = context.createStereoPanner();
                        panner.pan.value = snareParams.pan;
                        finalDestNoise.connect(panner);
                        finalDestNoise = panner;
                    }
                    finalDestNoise.connect(refs.masterGainRef.current);
                    noise.start(now);
                    noise.stop(now + snareParams.decay);
                }

                osc.connect(oscGain);
                finalDestOsc.connect(refs.masterGainRef.current);
                osc.start(now);
                osc.stop(now + snareParams.decay);
            } else {
                const hatParams = params as HatParams;
                if (refs.noiseBufferRef.current) {
                    const src = context.createBufferSource();
                    src.buffer = refs.noiseBufferRef.current;
                    const filter = context.createBiquadFilter();
                    filter.type = 'highpass';
                    filter.frequency.value = 5000;
                    const gain = context.createGain();
                    gain.gain.setValueAtTime(hatParams.volume, now);
                    gain.gain.exponentialRampToValueAtTime(0.001, now + hatParams.decay);

                    src.connect(filter);
                    filter.connect(gain);
                    let finalDest: AudioNode = gain;
                    if (hatParams.pan !== undefined && hatParams.pan !== 0) {
                        const panner = context.createStereoPanner();
                        panner.pan.value = hatParams.pan;
                        finalDest.connect(panner);
                        finalDest = panner;
                    }
                    finalDest.connect(refs.masterGainRef.current);
                    src.start(now);
                    src.stop(now + hatParams.decay);
                }
            }
        }
    };
}

export function createNoteOnSynth(
    context: AudioContext,
    refs: Pick<PlaybackRefs, 'open303ManagerRef' | 'voiceManagerARef' | 'voiceManagerBRef' | 'nextSynthNoteId' | 'activeSynthNotes'>,
): NoteOnSynthFn {
    return (params, note, time, track) => {
        const now = time || context.currentTime;

        if (track === 'bass2') {
            if (refs.open303ManagerRef.current?.isBass2Ready()) {
                const midi = noteToMidi(note);
                refs.open303ManagerRef.current.noteOnBass2(midi, 100);
                const id = refs.nextSynthNoteId.current++;
                refs.activeSynthNotes.current.set(id, { stop: () => refs.open303ManagerRef.current?.noteOffBass2(midi) });
                return id;
            }
            return null;
        }

        if (track === 'partB' && (params.waveform === '303-saw' || params.waveform === '303-sqr')) {
            if (refs.open303ManagerRef.current?.isBass1Ready()) {
                refs.open303ManagerRef.current.applyBass1Params(params, params.waveform === '303-sqr' ? 'sqr' : 'saw');
                const midi = noteToMidi(note);
                refs.open303ManagerRef.current.noteOnBass1(midi, 100);
                const id = refs.nextSynthNoteId.current++;
                refs.activeSynthNotes.current.set(id, { stop: () => refs.open303ManagerRef.current?.noteOffBass1(midi) });
                return id;
            }
        }

        let manager = refs.voiceManagerARef.current;
        if (track === 'partB') {
            manager = refs.voiceManagerBRef.current;
        }

        if (manager) {
            manager.noteOn(params, note, now);
            const id = refs.nextSynthNoteId.current++;
            refs.activeSynthNotes.current.set(id, {
                stop: () => manager?.noteOff(note, context.currentTime, params),
            });
            return id;
        }

        return null;
    };
}

export function noteOffSynth(activeSynthNotes: Map<number, ActiveSynthNote>, id: number): void {
    const entry = activeSynthNotes.get(id);
    if (!entry) {
        return;
    }

    entry.stop();
    activeSynthNotes.delete(id);
}

export function createStopAllNotes(
    refs: Pick<PlaybackRefs, 'activeSynthNotes' | 'activeSamplerNotes' | 'voiceManagerARef' | 'voiceManagerBRef' | 'singingVoiceManagerRef' | 'open303ManagerRef'>,
): NonNullable<AudioEngine['stopAllNotes']> {
    return () => {
        refs.activeSynthNotes.current.forEach((note) => note.stop());
        refs.activeSynthNotes.current.clear();

        refs.activeSamplerNotes.current.forEach((note) => {
            try {
                note.source.stop();
            } catch {
                // Ignore stop() errors from sources that have already stopped or are otherwise invalid.
            }
        });
        refs.activeSamplerNotes.current.clear();

        refs.voiceManagerARef.current?.stopAll();
        refs.voiceManagerBRef.current?.stopAll();
        refs.singingVoiceManagerRef.current?.stopAll();
        refs.open303ManagerRef.current?.noteOffBass1(0);
        refs.open303ManagerRef.current?.noteOffBass2(0);
    };
}

export function createAmbianceControls(
    context: AudioContext,
    refs: Pick<PlaybackRefs, 'masterGainRef' | 'ambianceSourceNodeRef' | 'ambianceGainNodeRef' | 'loadedAmbianceBuffersRef'>,
): Pick<AudioEngine, 'playAmbiance' | 'stopAmbiance' | 'setAmbianceVolume'> {
    const playAmbiance: AudioEngine['playAmbiance'] = async (url) => {
        if (refs.ambianceSourceNodeRef.current) {
            try {
                refs.ambianceSourceNodeRef.current.stop();
            } catch {
                // Ignore stop() errors from ambiance sources that have already stopped or are otherwise invalid.
            }
        }

        let buffer = refs.loadedAmbianceBuffersRef.current.get(url);
        if (!buffer) {
            const res = await fetch(url);
            const arrayBuffer = await res.arrayBuffer();
            buffer = await context.decodeAudioData(arrayBuffer);
            refs.loadedAmbianceBuffersRef.current.set(url, buffer);
        }

        if (refs.ambianceGainNodeRef.current === null) {
            refs.ambianceGainNodeRef.current = context.createGain();
            refs.ambianceGainNodeRef.current.connect(refs.masterGainRef.current!);
        }

        const src = context.createBufferSource();
        src.buffer = buffer;
        src.loop = true;
        src.connect(refs.ambianceGainNodeRef.current);
        src.start(0);
        refs.ambianceSourceNodeRef.current = src;
    };

    const stopAmbiance = () => {
        const source = refs.ambianceSourceNodeRef.current;
        if (!source) {
            return;
        }
        try {
            source.stop();
        } catch {
            // Ignore stop() errors from ambiance sources that have already stopped or are otherwise invalid.
        }
        refs.ambianceSourceNodeRef.current = null;
    };

    const setAmbianceVolume = (value: number) => {
        if (refs.ambianceGainNodeRef.current) {
            refs.ambianceGainNodeRef.current.gain.value = value;
        }
    };

    return { playAmbiance, stopAmbiance, setAmbianceVolume };
}

export function setMasterVolume(masterGainRef: MutableRefObject<GainNode | null>, value: number): void {
    if (masterGainRef.current) {
        masterGainRef.current.gain.value = value;
    }
}

export function setMasterSaturation(masterSaturationRef: MutableRefObject<WaveShaperNode | null>, amount: number): void {
    if (masterSaturationRef.current) {
        masterSaturationRef.current.curve = makeDistortionCurve(amount * 100);
    }
}

export function setGlobalPan(masterPannerRef: MutableRefObject<StereoPannerNode | null>, value: number): void {
    if (masterPannerRef.current) {
        masterPannerRef.current.pan.value = value;
    }
}

export function setHarmonizerConfig(
    harmonizerRef: MutableRefObject<Harmonizer | null>,
    config: HarmonizerConfig,
    isActive: boolean,
): void {
    if (!harmonizerRef.current) {
        return;
    }

    harmonizerRef.current.setConfig(config);
    harmonizerRef.current.setActive(isActive);
    console.log('[useAudioEngine] Harmonizer config updated:', config, 'active:', isActive);
}
