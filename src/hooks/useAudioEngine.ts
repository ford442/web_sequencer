import { type AlignmentResult } from '../engines/rubberband/PhonemeAligner';
import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import type {
    SamplerBankParams, SynthParams, AudioEngine, PartSequence, MultisampleBank, PhonemeData
} from '../types';
import { WebGpuOscillator } from '../engines/WebGpuOscillator';
import { WasmOscillator } from '../engines/WasmOscillator';
import { Open303Manager } from '../engines/Open303Manager';
import { SingingVoice } from '../engines/SingingVoice';
import { SingingVoiceManager } from '../engines/SingingVoiceManager';
import { VoiceManager } from '../engines/VoiceManager';
import { noteToMidi, type ScaleDefinition } from '../utils/musicTheory';
import { MultisampleGenerator } from '../engines/MultisampleGenerator';
import { DrumKitEngine } from '../engines/DrumKitEngine';
import { ProphecyManager } from '../engines/ProphecyManager';
import { Harmonizer, type HarmonizerConfig } from '../engines/Harmonizer';
import { PhonemeBufferPool } from '../services/PhonemeBufferPool';
import {
    createAmbianceControls,
    createNoteOnSynth,
    createPlayDrum,
    createPlaySynth,
    createStopAllNotes,
    noteOffSynth,
    setGlobalPan as setMasterPan,
    setHarmonizerConfig as applyHarmonizerConfig,
    setMasterVolume as setMasterGainVolume,
    setMasterSaturation as setMasterGainSaturation,
    type PlaybackRefs,
} from './audioEngine/audioPlayback';
import { makeDistortionCurve } from './audioEngine/distortion';
import {
    applySamplerVoiceParamUpdate,
    applyVoiceParamUpdate,
    createSampleLibraryControls,
} from './audioEngine/sampleManagement';
import {
    createNoiseBuffer,
    initializeHarmonizer,
    initializeChoirBuses,
    initializeMasterOutput,
    initializeSustainProcessor,
    loadWavBuffer,
    createReverbImpulseResponse,
} from './audioEngine/initialization';
import { engineTelemetry } from '../utils/engineTelemetry';

// URLs for worklets
import sustainProcessorUrl from '../audio-worklets/sustain-processor.ts?worker&url';
import open303ProcessorUrl from '../audio-worklets/open303-processor.ts?worker&url';

type AudioWindow = Window & typeof globalThis & {
    webkitAudioContext?: typeof AudioContext;
    audioContext?: AudioContext;
};

type ResolvedExpressiveness = {
    vibratoRate: number;
    vibratoDepth: number;
    tremoloDepth: number;
    breathAmount: number;
};

const resolveExpressiveness = (params: SamplerBankParams): ResolvedExpressiveness => {
    const cfg = params.expressiveness;
    const normalizeDepth = (value: number | undefined) => {
        if (value === undefined) return 0;
        // Backward compatibility: older UI/state stores depths as 0-100 percentages,
        // while newer expressiveness config stores normalized 0-1 values.
        return value > 1 ? value / 100 : value;
    };
    return {
        vibratoRate: cfg?.vibratoRate ?? 5.5,
        vibratoDepth: normalizeDepth(cfg?.vibratoDepth ?? params.vibratoDepth),
        tremoloDepth: normalizeDepth(cfg?.tremoloDepth ?? params.tremoloDepth),
        breathAmount: cfg?.breathAmount ?? params.breathIntensity ?? 0,
    };
};

const EXPRESSIVE_STOP_BUFFER_SECONDS = 0.02;

export interface SamplerVoiceContext {
    context: AudioContext;
    params: SamplerBankParams;
    noteParams: any;
    actualTime: number;
    durationSteps: number;
    stepTime: number;
    buffer: AudioBuffer;
    multisampleBank: any;
    pitchOffsetSemitones: number;
    expressiveConfig: any;

    // Extracted parameter resolutions
    pFilterCutoff: number;
    pFilterResonance: number;
    pDriveAmount: number;
    vocoderMix: number;
    pVocoderFormantShift: number;
    pVocoderPreservation: number;
    pVocoderAttack: number;
    pVocoderRelease: number;
    spectralPanLfoRate: number;
    spectralPanDepth: number;
    targetReverbNode: AudioNode;
    reverbSendAmount: number;
    reverbEqCutoff: number;
    revLfoRate: number;
    revLfoDepth: number;
    delaySendAmount: number;
    targetFormantShift: number;
    startFormantShift: number | undefined;
    pVibratoDepth: number | undefined;
    pGateDepth: number | undefined;
    pGateRateHz: number | undefined;
    pAttack: number | undefined;
    pDecay: number | undefined;
    pSustain: number | undefined;
    pRelease: number | undefined;
    pFreeze: number | undefined;
    pFreezeLfoRate: number | undefined;
    pFreezeLfoDepth: number | undefined;
    pFreezeEnvDepth: number | undefined;
    pTimeStretchEnvDepth: number | undefined;
    pGrainEnvDepth: number | undefined;
    pGrainPitchEnvDepth: number | undefined;
    pGrainJitter: number | undefined;
    pGrainPitchQuantize: number | undefined;
    pGranularPitchShift: number | undefined;
    pBitcrush: number | undefined;
    pDownsample: number | undefined;
    pTranceGate: number | undefined;
    pFormantLfoRateHz: number | undefined;
    pFormantLfoDepth: number | undefined;
    pFormantLfoShape: number[] | undefined;
    pEnvAttack: number;
    pEnvDecay: number;
    pEnvAmount: number;
    pFormantEnvFollower: number;
    pPitchDecay: number;
    pPitchAmount: number;
    characterMorph: number;
    morphTarget: string;
    alignment: any;
    tuning: any;
    manager: any;

    // Refs
    refs: {
        masterGainRef: React.MutableRefObject<GainNode | null>;
        masterSaturationRef: React.MutableRefObject<WaveShaperNode | null>;
        delayNodeRef: React.MutableRefObject<AudioNode | null>;
        reverbNodesRef: React.MutableRefObject<Record<string, AudioNode>>;
        reverbTypeRef: React.MutableRefObject<string>;
        vocalOverdrivePoolRef: React.MutableRefObject<any>;
        expressiveVoiceProcessorPoolRef: React.MutableRefObject<any>;
        singingVoiceManagerRef: React.MutableRefObject<any>;
        harmonyBusGainRef: React.MutableRefObject<GainNode | null>;
        synthABusRef: React.MutableRefObject<GainNode | null>;
        choirLeftGainRef: React.MutableRefObject<GainNode | null>;
        choirRightGainRef: React.MutableRefObject<GainNode | null>;
    };
}

const triggerVoice = (ctx: SamplerVoiceContext, noteStr: string, voice: SingingVoice, pitchOffset: number, overrideTime?: number, overrideDuration?: number, destination?: AudioNode, isNewBank: boolean = true) => {
                            const targetDuration = overrideDuration !== undefined ? overrideDuration : (ctx.durationSteps * ctx.stepTime);
                            const originalDuration = ctx.buffer.duration;
                            const triggerTime = overrideTime !== undefined ? overrideTime : ctx.actualTime;

                            // Ensure voice connected to correct output
                            voice.disconnectOutput();
                            let finalDest = destination;
                            // Track any ExpressiveVoiceProcessor node created for this voice
                            // so it can be torn down when the voice ends.
                            let expressiveVoiceNode: AudioWorkletNode | null = null;
                            let overdriveNodeRef: AudioWorkletNode | null = null;
                            if (!finalDest) {
                                if (ctx.noteParams?.isHarmonyVoice && ctx.refs.harmonyBusGainRef.current) {
                                    // Insert ExpressiveVoiceProcessor between the effects chain
                                    // and the harmony bus to correct the formant shift introduced
                                    // by the pitch transposition (playbackRate / rubberband).
                                    // `parameterData` sets the initial AudioParam value per spec
                                    // (Web Audio API §AudioWorkletNodeOptions.parameterData).
                                    try {
                                        const node = ctx.refs.expressiveVoiceProcessorPoolRef.current?.acquire({ pitchShift: ctx.pitchOffsetSemitones }) || new AudioWorkletNode(ctx.context, 'expressive-voice-processor', {
                                            parameterData: { pitchShift: ctx.pitchOffsetSemitones }
                                        });
                                        node.connect(ctx.refs.harmonyBusGainRef.current);
                                        expressiveVoiceNode = node;
                                        finalDest = node;
                                    } catch (_err) {
                                        // Worklet not yet registered — fall back to direct harmony bus.
                                        finalDest = ctx.refs.harmonyBusGainRef.current;
                                    }
                                } else {
                                    finalDest = ctx.refs.masterSaturationRef.current!;
                                }
                            }

                            // Apply Drive/Distortion if present
                            const driveAmount = ctx.noteParams?.drive !== undefined ? ctx.noteParams.drive : ctx.params.drive;
                            if (driveAmount !== undefined && driveAmount > 0) {
                                try {
                                    const overdriveNode = overdriveNodeRef = ctx.refs.vocalOverdrivePoolRef.current?.acquire({ drive: driveAmount }) || new AudioWorkletNode(ctx.context, 'vocal-overdrive-processor', {
                                        parameterData: { drive: driveAmount }
                                    });
                                    overdriveNode.connect(finalDest);
                                    finalDest = overdriveNode;
                                } catch (e) {
                                    const shaper = ctx.context.createWaveShaper();
                                    shaper.curve = makeDistortionCurve(driveAmount * 100);
                                    shaper.connect(finalDest);
                                    finalDest = shaper;
                                }
                            }

                            // Apply Per-Step Filter if present, or fallback to global filter settings
                            if (ctx.noteParams?.filterCutoff !== undefined || ctx.noteParams?.filterResonance !== undefined || ctx.params.filterCutoff !== undefined || ctx.params.filterResonance !== undefined) {
                                const filter = ctx.context.createBiquadFilter();
                                filter.type = 'lowpass';

                                const cutoff = ctx.noteParams?.filterCutoff !== undefined
                                    ? Math.max(20, ctx.noteParams.filterCutoff * 20000)
                                    : (ctx.params.filterCutoff ?? 20000);
                                filter.frequency.value = cutoff;

                                const resonance = ctx.noteParams?.filterResonance !== undefined
                                    ? ctx.noteParams.filterResonance * 20
                                    : (ctx.params.filterResonance ?? 0);
                                filter.Q.value = resonance;

                                filter.connect(finalDest);
                                finalDest = filter;
                            }

                            // Apply Vocoder if present
                            let vocoderNodeRef: AudioWorkletNode | null = null;
                            if (ctx.vocoderMix > 0 && ctx.refs.synthABusRef.current) {
                                try {
                                    const vocoderNode = new AudioWorkletNode(ctx.context, 'vocoder-processor', {
                                        numberOfInputs: 2,
                                        parameterData: {
                                            mix: ctx.vocoderMix,
                                            formantShift: ctx.pVocoderFormantShift,
                                            preservation: ctx.pVocoderPreservation,
                                            envelopeAttack: ctx.pVocoderAttack,
                                            envelopeRelease: ctx.pVocoderRelease
                                        }
                                    });
                                    // Connect Synth A to carrier (input 0)
                                    ctx.refs.synthABusRef.current.connect(vocoderNode, 0, 0);

                                    // Connect Vocoder output to next in chain
                                    vocoderNode.connect(finalDest);

                                    // We need to route the TTS source to modulator (input 1)
                                    // Create a gain to act as the new finalDest for the TTS source
                                    const modulatorGain = ctx.context.createGain();
                                    modulatorGain.connect(vocoderNode, 0, 1);

                                    vocoderNodeRef = vocoderNode;
                                    finalDest = modulatorGain;
                                } catch (e) {
                                    console.warn("Failed to instantiate vocoder node", e);
                                }
                            }

                            let spectralFinalDest = finalDest;
                            let wetGain: GainNode | null = null;
                            // Apply Spectral Panning
                            if (ctx.spectralPanDepth !== undefined && ctx.spectralPanDepth > 0) {
                                const lowBand = ctx.context.createBiquadFilter();
                                lowBand.type = "lowpass";
                                lowBand.frequency.value = 400;

                                const midBand = ctx.context.createBiquadFilter();
                                midBand.type = "bandpass";
                                midBand.frequency.value = 1500;
                                midBand.Q.value = 1;

                                const highBand = ctx.context.createBiquadFilter();
                                highBand.type = "highpass";
                                highBand.frequency.value = 4000;

                                const lowPanner = ctx.context.createStereoPanner();
                                const midPanner = ctx.context.createStereoPanner();
                                const highPanner = ctx.context.createStereoPanner();

                                const lowLfo = ctx.context.createOscillator();
                                lowLfo.type = "sine";
                                lowLfo.frequency.value = ctx.spectralPanLfoRate * 0.5;
                                const lowGain = ctx.context.createGain();
                                lowGain.gain.value = ctx.spectralPanDepth;
                                lowLfo.connect(lowGain);
                                lowGain.connect(lowPanner.pan);
                                lowLfo.start(triggerTime);

                                const midLfo = ctx.context.createOscillator();
                                midLfo.type = "sine";
                                midLfo.frequency.value = ctx.spectralPanLfoRate * 0.75;
                                const midGain = ctx.context.createGain();
                                midGain.gain.value = ctx.spectralPanDepth * 0.8;
                                midLfo.connect(midGain);
                                midGain.connect(midPanner.pan);
                                midLfo.start(triggerTime);

                                const highLfo = ctx.context.createOscillator();
                                highLfo.type = "sine";
                                highLfo.frequency.value = ctx.spectralPanLfoRate;
                                const highGain = ctx.context.createGain();
                                highGain.gain.value = ctx.spectralPanDepth * 1.2;
                                highLfo.connect(highGain);
                                highGain.connect(highPanner.pan);
                                highLfo.start(triggerTime);

                                lowBand.connect(lowPanner);
                                midBand.connect(midPanner);
                                highBand.connect(highPanner);

                                lowPanner.connect(finalDest);
                                midPanner.connect(finalDest);
                                highPanner.connect(finalDest);

                                const dryGain = ctx.context.createGain();
                                dryGain.gain.value = 1.0 - ctx.spectralPanDepth;
                                dryGain.connect(finalDest);

                                wetGain = ctx.context.createGain();
                                wetGain.gain.value = ctx.spectralPanDepth;
                                wetGain.connect(lowBand);
                                wetGain.connect(midBand);
                                wetGain.connect(highBand);

                                voice.connectOutput(dryGain);
                                voice.connectOutput(wetGain);
                                spectralFinalDest = dryGain;

                                // Clean up LFOs when voice finishes
                                const stopOscillators = () => {
                                    try { lowLfo.stop(); } catch(e){}
                                    try { midLfo.stop(); } catch(e){}
                                    try { highLfo.stop(); } catch(e){}
                                };
                                // this may not be perfect teardown if stretch voice lasts longer, but it is a start
                                setTimeout(stopOscillators, targetDuration * 1000 + 100);
                            } else {
                                voice.connectOutput(finalDest);
                            }

                            // Setup Reverb Send (Formant-Aware)
                            if (ctx.reverbSendAmount > 0 && ctx.targetReverbNode) {
                                const reverbGain = ctx.context.createGain();
                                reverbGain.gain.value = ctx.reverbSendAmount;

                                const formantReverbEq = ctx.context.createBiquadFilter();
                                formantReverbEq.type = 'lowpass';
                                formantReverbEq.frequency.value = ctx.reverbEqCutoff;
                                formantReverbEq.Q.value = 0.5; // Gentle slope

                                if (ctx.revLfoDepth > 0 && ctx.revLfoRate > 0) {
                                    // Base amount minus the max modulation depth ensures we duck down
                                    const minGain = Math.max(0, ctx.reverbSendAmount * (1 - ctx.revLfoDepth));
                                    const maxGain = ctx.reverbSendAmount;
                                    const midGain = (maxGain + minGain) / 2;
                                    const amplitude = (maxGain - minGain) / 2;

                                    reverbGain.gain.value = midGain; // Set base level to midpoint

                                    // LFO to modulate gain up to ctx.reverbSendAmount
                                    const lfo = ctx.context.createOscillator();
                                    lfo.type = 'sine';
                                    lfo.frequency.value = ctx.revLfoRate;

                                    const lfoDepthGain = ctx.context.createGain();
                                    lfoDepthGain.gain.value = amplitude;

                                    lfo.connect(lfoDepthGain);
                                    lfoDepthGain.connect(reverbGain.gain);

                                    lfo.start(triggerTime);
                                    lfo.stop(triggerTime + targetDuration + 1.0); // Stop after duration + tail
                                }

                                reverbGain.connect(formantReverbEq);
                                formantReverbEq.connect(ctx.targetReverbNode);
                                voice.connectOutput(reverbGain); // connectOutput appends to existing connections
                            }

                            // Setup Delay Send
                            if (ctx.delaySendAmount > 0 && ctx.refs.delayNodeRef.current) {
                                const delayGain = ctx.context.createGain();
                                delayGain.gain.value = ctx.delaySendAmount;
                                delayGain.connect(ctx.refs.delayNodeRef.current);
                                voice.connectOutput(delayGain);
                            }

                            // Apply Timbre Modulation (Formant Shift)
                            if (ctx.startFormantShift !== undefined && (ctx.noteParams?.slideFromMidi !== undefined || ctx.noteParams?.slideFromFormant !== undefined)) {
                                const glideDuration = Math.min(Math.max(targetDuration * 0.5, 0.15), targetDuration);
                                voice.setFormantGlide(ctx.startFormantShift, ctx.targetFormantShift, triggerTime, glideDuration);
                            } else {
                                voice.setFormantShift(ctx.targetFormantShift, triggerTime);
                            }

                            // Apply Character Morphing
                            voice.setCharacterMorph(ctx.characterMorph, ctx.morphTarget as any, 0.05); // Use short ramp time

                            // Sync other ctx.params
                            if (ctx.pVibratoDepth !== undefined) voice.setVibratoDepth(ctx.pVibratoDepth, triggerTime);
                            if (ctx.pGateDepth !== undefined) voice.setGateDepth(ctx.pGateDepth, triggerTime);
                            if (ctx.pGateRateHz !== undefined) voice.setGateRate(ctx.pGateRateHz, triggerTime);

                            if (ctx.pAttack !== undefined) voice.setAttack(ctx.pAttack, triggerTime);
                            if (ctx.pDecay !== undefined) voice.setDecay(ctx.pDecay, triggerTime);
                            if (ctx.pSustain !== undefined) voice.setSustain(ctx.pSustain, triggerTime);
                            if (ctx.pRelease !== undefined) voice.setRelease(ctx.pRelease, triggerTime);

                            if (ctx.pFreeze !== undefined) voice.setFreeze(ctx.pFreeze, triggerTime);
                            if (ctx.pFreezeLfoRate !== undefined) voice.setFreezeLfoRate(ctx.pFreezeLfoRate, triggerTime);
                            if (ctx.pFreezeLfoDepth !== undefined) voice.setFreezeLfoDepth(ctx.pFreezeLfoDepth, triggerTime);

                            if (ctx.pFreezeEnvDepth !== undefined) voice.setFreezeEnvDepth(ctx.pFreezeEnvDepth, triggerTime);
                            if (ctx.pTimeStretchEnvDepth !== undefined) voice.setTimeStretchEnvDepth(ctx.pTimeStretchEnvDepth, triggerTime);
                            if (ctx.pGrainEnvDepth !== undefined) voice.setGrainEnvDepth(ctx.pGrainEnvDepth, triggerTime);
                            if (ctx.pGrainPitchEnvDepth !== undefined) voice.setGrainPitchEnvDepth(ctx.pGrainPitchEnvDepth, triggerTime);
                            if (ctx.pGrainJitter !== undefined) voice.setGrainJitter(ctx.pGrainJitter, triggerTime);
                            if (ctx.pGrainPitchQuantize !== undefined) voice.setGrainPitchQuantize(ctx.pGrainPitchQuantize, triggerTime);

                            if (ctx.pGranularPitchShift !== undefined) voice.setGranularPitchShift(ctx.pGranularPitchShift, triggerTime);
                            if (ctx.pBitcrush !== undefined) voice.setBitcrush(ctx.pBitcrush, triggerTime);
                            if (ctx.pDownsample !== undefined) voice.setDownsample(ctx.pDownsample, triggerTime);
                            if (ctx.pTranceGate !== undefined) voice.setTranceGate(ctx.pTranceGate, triggerTime);

                            if (ctx.pFormantLfoRateHz !== undefined) voice.setFormantLfoRate(ctx.pFormantLfoRateHz, triggerTime);
                            if (ctx.pFormantLfoDepth !== undefined) voice.setFormantLfoDepth(ctx.pFormantLfoDepth, triggerTime);
                            voice.setFormantLfoShape(ctx.pFormantLfoShape);

                            if (ctx.pEnvAmount !== 0) voice.setFormantEnvelope(ctx.pEnvAmount, ctx.pEnvAttack as number, ctx.pEnvDecay as number, triggerTime);
                            voice.setFormantEnvFollower(ctx.pFormantEnvFollower, triggerTime);

                            // Load ctx.buffer only if the voice doesn't already have it
                            if (isNewBank) {
                                voice.loadBuffer(ctx.buffer.getChannelData(0));
                            }

                            // CHECK FOR SLICE TRIGGER MODE
                            if (ctx.params.sliceMode === 'phoneme' && ctx.alignment) {
                                let sliceIndex = -1;
                                let pitchRatio = 1.0;

                                if (ctx.noteParams?.sliceIndex !== undefined) {
                                    sliceIndex = ctx.noteParams.sliceIndex;
                                    const targetMidi = noteToMidi(noteStr);
                                    const baseMidi = 60;
                                    pitchRatio = Math.pow(2, (targetMidi - baseMidi + pitchOffset + ctx.pitchOffsetSemitones) / 12);
                                } else {
                                    const targetMidi = noteToMidi(noteStr);
                                    sliceIndex = targetMidi - 60;
                                    pitchRatio = Math.pow(2, (pitchOffset + ctx.pitchOffsetSemitones) / 12);
                                }

                                if (sliceIndex >= 0) {
                                    const phonemeId = `${ctx.params.sampleName}_${sliceIndex}`;
                                    voice.triggerSlice(
                                        ctx.buffer.getChannelData(0),
                                        sliceIndex,
                                        ctx.alignment,
                                        pitchRatio,
                                        ctx.noteParams?.reverse,
                                        targetDuration,
                                        triggerTime,
                                        phonemeId,
                                    );
                                    return;
                                }
                            }

                            // 1. Calculate Time Ratio
                            const timeRatio = targetDuration / originalDuration;
                            voice.setTimeRatio(timeRatio, triggerTime);

                            // 2. Pitch Shift (with offset for harmonizer and slide support)
                            const targetMidi = noteToMidi(noteStr) + ctx.pitchOffsetSemitones;
                            if (ctx.noteParams?.slideFromMidi !== undefined) {
                                const startMidi = ctx.noteParams.slideFromMidi + ctx.pitchOffsetSemitones;
                                voice.setPitchFromMidi(startMidi + pitchOffset, 60, triggerTime, undefined, undefined, ctx.tuning);
                                // Glide over half the target duration or a minimum of 0.15s, bounded by actual duration
                                const glideDuration = Math.min(Math.max(targetDuration * 0.5, 0.15), targetDuration);

                                if (ctx.noteParams?.slideType === 'exponential' || ctx.params.portamentoType === 'exponential') {
                                    voice.exponentialRampPitchFromMidi(targetMidi + pitchOffset, 60, triggerTime + glideDuration, undefined, undefined, ctx.tuning);
                                } else {
                                    voice.linearRampPitchFromMidi(targetMidi + pitchOffset, 60, triggerTime + glideDuration, undefined, undefined, ctx.tuning);
                                }
                            } else {
                                voice.setPitchFromMidi(targetMidi + pitchOffset, 60, triggerTime, undefined, undefined, ctx.tuning);
                            }

                            // 3. Phoneme Awareness (from Jules branch)
                            if (ctx.alignment) {
                                voice.setAlignment(ctx.alignment);
                                voice.sendPhonemeDataToWorklet(targetDuration);
                            }

                            // 4. Play

                            // Pitch Envelope
                            if (voice.setPitchAttack) {
                                const pAttackLocal = (ctx.noteParams as any)?.pitchAttack ?? ctx.params.pitchAttack ?? 0;
                                voice.setPitchAttack(pAttackLocal, triggerTime);
                            }
                            if (voice.setPitchDecay) {
                                voice.setPitchDecay(ctx.pPitchDecay, triggerTime);
                            }
                            if ((voice as any).setPitchAmount) {
                                (voice as any).setPitchAmount(ctx.pPitchAmount, triggerTime);
                            }

                            voice.play(undefined, undefined, 1.0, ctx.noteParams?.reverse);

                            const releaseTime = triggerTime + targetDuration;
                            const delayMs = (releaseTime - ctx.context.currentTime) * 1000;
                            if (delayMs > 0) {
                                setTimeout(() => {
                                    voice.noteOff();
                                    if (expressiveVoiceNode) {
                                        expressiveVoiceNode.port.postMessage({ type: 'TEARDOWN' });
                                        ctx.refs.expressiveVoiceProcessorPoolRef.current?.release(expressiveVoiceNode);
                                    }
                                    if (overdriveNodeRef) {
                                        ctx.refs.vocalOverdrivePoolRef.current?.release(overdriveNodeRef);
                                    }
                                    if (vocoderNodeRef) {
                                        ctx.refs.synthABusRef.current?.disconnect(vocoderNodeRef);
                                        vocoderNodeRef.disconnect();
                                    }
                                }, delayMs);
                            } else {
                                voice.noteOff();
                                if (expressiveVoiceNode) {
                                    expressiveVoiceNode.port.postMessage({ type: 'TEARDOWN' });
                                    ctx.refs.expressiveVoiceProcessorPoolRef.current?.release(expressiveVoiceNode);
                                }
                                if (overdriveNodeRef) {
                                    ctx.refs.vocalOverdrivePoolRef.current?.release(overdriveNodeRef);
                                }
                                if (vocoderNodeRef) {
                                    ctx.refs.synthABusRef.current?.disconnect(vocoderNodeRef);
                                    vocoderNodeRef.disconnect();
                                }
                            }
                        }

const runVoices = (ctx: SamplerVoiceContext, noteStr: string, timeOffset: number, duration: number) => {
                            const t = ctx.actualTime + timeOffset;

                            const mainVoiceData = ctx.manager.acquireVoiceForBank(ctx.params.sampleName);
                            ctx.manager.registerActiveVoice(mainVoiceData.index, noteStr, t);
                            triggerVoice(ctx, noteStr, mainVoiceData.voice, 0, t, duration, undefined, mainVoiceData.isNewBank);

                            const effectiveChoir = ctx.noteParams?.choir !== undefined ? ctx.noteParams.choir : (ctx.params.choir || 0);

                            if (effectiveChoir > 0 && ctx.pitchOffsetSemitones === 0) {
                                const detune = 0.15;
                                const gain = effectiveChoir * 0.7;

                                if (ctx.refs.choirLeftGainRef.current) ctx.refs.choirLeftGainRef.current.gain.setTargetAtTime(gain, t, 0.02);
                                if (ctx.refs.choirRightGainRef.current) ctx.refs.choirRightGainRef.current.gain.setTargetAtTime(gain, t, 0.02);

                                const leftVoiceData = ctx.manager.acquireVoiceForBank(ctx.params.sampleName);
                                if (leftVoiceData.index !== mainVoiceData.index) {
                                    ctx.manager.registerActiveVoice(leftVoiceData.index, `${noteStr}_L`, t);
                                    triggerVoice(ctx, noteStr, leftVoiceData.voice, detune, t, duration, ctx.refs.choirLeftGainRef.current!, leftVoiceData.isNewBank);
                                }

                                const rightVoiceData = ctx.manager.acquireVoiceForBank(ctx.params.sampleName);
                                if (rightVoiceData.index !== mainVoiceData.index && rightVoiceData.index !== leftVoiceData.index) {
                                    ctx.manager.registerActiveVoice(rightVoiceData.index, `${noteStr}_R`, t);
                                    triggerVoice(ctx, noteStr, rightVoiceData.voice, -detune, t, duration, ctx.refs.choirRightGainRef.current!, rightVoiceData.isNewBank);
                                }
                            } else if (ctx.pitchOffsetSemitones === 0) {
                                if (ctx.refs.choirLeftGainRef.current) ctx.refs.choirLeftGainRef.current.gain.setTargetAtTime(0, t, 0.02);
                                if (ctx.refs.choirRightGainRef.current) ctx.refs.choirRightGainRef.current.gain.setTargetAtTime(0, t, 0.02);
                            }
                        }

const playBufferSource = (ctx: SamplerVoiceContext, startTime: number, duration: number, pitchSemitones: number) => {
                    const source = ctx.context.createBufferSource();

                    const targetMidi = pitchSemitones;
                    let playbackBuffer: AudioBuffer;
                    let pitchRatio = 1.0;

                    if (ctx.multisampleBank?.pitchBank.has(targetMidi)) {
                        playbackBuffer = ctx.multisampleBank.pitchBank.get(targetMidi)!;
                        pitchRatio = ctx.params.playbackSpeed;
                    } else {
                        playbackBuffer = ctx.multisampleBank?.baseBuffer || ctx.buffer;
                        const rootMidi = ctx.multisampleBank?.rootNote ?? 60;
                        const speed = ctx.params.playbackSpeed;
                        pitchRatio = speed * Math.pow(2, (targetMidi - rootMidi) / 12);
                    }

                    source.buffer = playbackBuffer;
                    source.playbackRate.value = pitchRatio;

                    const gain = ctx.context.createGain();
                    gain.gain.value = ctx.params.volume;

                    const filter = ctx.context.createBiquadFilter();
                    filter.type = 'lowpass';
                    filter.frequency.value = ctx.pFilterCutoff;
                    filter.Q.value = ctx.pFilterResonance;

                    let finalShaperDest: AudioNode | null = null;
                    let overdriveNodeRef: AudioWorkletNode | null = null;
                    const driveAmount = ctx.pDriveAmount;
                    if (driveAmount > 0) {
                        try {
                            const overdriveNode = overdriveNodeRef = ctx.refs.vocalOverdrivePoolRef.current?.acquire({ drive: driveAmount }) || new AudioWorkletNode(ctx.context, 'vocal-overdrive-processor', {
                                parameterData: { drive: driveAmount }
                            });
                            finalShaperDest = overdriveNode;
                        } catch (e) {
                            const shaper = ctx.context.createWaveShaper();
                            shaper.curve = makeDistortionCurve(driveAmount * 100);
                            finalShaperDest = shaper;
                        }
                    } else {
                        const shaper = ctx.context.createWaveShaper();
                        shaper.curve = null;
                        finalShaperDest = shaper;
                    }

                    // Insert ExpressiveVoiceProcessor before the harmony bus to correct
                    // the formant shift introduced by playbackRate-based pitch transposition.
                    // `parameterData` sets the initial AudioParam value per spec
                    // (Web Audio API §AudioWorkletNodeOptions.parameterData).
                    let finalDestination: AudioNode;
                    if (ctx.noteParams?.isHarmonyVoice && ctx.refs.harmonyBusGainRef.current) {
                        try {
                            const expressiveNode = ctx.refs.expressiveVoiceProcessorPoolRef.current?.acquire({ pitchShift: ctx.pitchOffsetSemitones }) || new AudioWorkletNode(ctx.context, 'expressive-voice-processor', {
                                parameterData: { pitchShift: ctx.pitchOffsetSemitones }
                            });
                            expressiveNode.connect(ctx.refs.harmonyBusGainRef.current);
                            // Tear down the processor when the source finishes playback.
                            source.addEventListener('ended', () => {
                                expressiveNode.port.postMessage({ type: 'TEARDOWN' });
                                ctx.refs.expressiveVoiceProcessorPoolRef.current?.release(expressiveNode);
                            });
                            finalDestination = expressiveNode;
                        } catch (_err) {
                            // Worklet not yet registered — fall back to direct harmony bus.
                            finalDestination = ctx.refs.harmonyBusGainRef.current;
                        }
                    } else {
                        finalDestination = ctx.refs.masterSaturationRef.current!;
                    }

                    // Apply Vocoder if present
                    let vocoderNodeRef: AudioWorkletNode | null = null;
                    if (ctx.vocoderMix > 0 && ctx.refs.synthABusRef.current) {
                        try {
                            const vocoderNode = new AudioWorkletNode(ctx.context, 'vocoder-processor', {
                                numberOfInputs: 2,
                                parameterData: {
                                    mix: ctx.vocoderMix,
                                    formantShift: ctx.pVocoderFormantShift,
                                    preservation: ctx.pVocoderPreservation,
                                    envelopeAttack: ctx.pVocoderAttack,
                                    envelopeRelease: ctx.pVocoderRelease
                                }
                            });
                            // Connect Synth A to carrier (input 0)
                            ctx.refs.synthABusRef.current.connect(vocoderNode, 0, 0);

                            // Connect Vocoder output to next in chain
                            vocoderNode.connect(finalDestination);

                            // Create a gain to act as the new finalDestination for the TTS source
                            const modulatorGain = ctx.context.createGain();
                            modulatorGain.connect(vocoderNode, 0, 1);

                            vocoderNodeRef = vocoderNode;
                            finalDestination = modulatorGain;

                            // Clean up
                            source.addEventListener('ended', () => {
                                ctx.refs.synthABusRef.current?.disconnect(vocoderNode);
                                vocoderNode.disconnect();
                            });
                        } catch (e) {
                            console.warn("Failed to instantiate vocoder node", e);
                        }
                    }

                    let spectralFinalDest = finalDestination;
                    let wetGain: GainNode | null = null;
                    if (ctx.spectralPanDepth !== undefined && ctx.spectralPanDepth > 0) {
                        // Parallel low/band/high bands with independent LFO panners for spectral movement
                        const lowBand = ctx.context.createBiquadFilter();
                        lowBand.type = "lowpass";
                        lowBand.frequency.value = 400;

                        const midBand = ctx.context.createBiquadFilter();
                        midBand.type = "bandpass";
                        midBand.frequency.value = 1500;
                        midBand.Q.value = 1;

                        const highBand = ctx.context.createBiquadFilter();
                        highBand.type = "highpass";
                        highBand.frequency.value = 4000;

                        const lowPanner = ctx.context.createStereoPanner();
                        const midPanner = ctx.context.createStereoPanner();
                        const highPanner = ctx.context.createStereoPanner();

                        const lowLfo = ctx.context.createOscillator();
                        lowLfo.type = "sine";
                        lowLfo.frequency.value = ctx.spectralPanLfoRate * 0.5;
                        const lowGain = ctx.context.createGain();
                        lowGain.gain.value = ctx.spectralPanDepth;
                        lowLfo.connect(lowGain);
                        lowGain.connect(lowPanner.pan);
                        lowLfo.start(startTime);

                        const midLfo = ctx.context.createOscillator();
                        midLfo.type = "sine";
                        midLfo.frequency.value = ctx.spectralPanLfoRate * 0.75;
                        const midGain = ctx.context.createGain();
                        midGain.gain.value = ctx.spectralPanDepth * 0.8;
                        midLfo.connect(midGain);
                        midGain.connect(midPanner.pan);
                        midLfo.start(startTime);

                        const highLfo = ctx.context.createOscillator();
                        highLfo.type = "sine";
                        highLfo.frequency.value = ctx.spectralPanLfoRate;
                        const highGain = ctx.context.createGain();
                        highGain.gain.value = ctx.spectralPanDepth * 1.2;
                        highLfo.connect(highGain);
                        highGain.connect(highPanner.pan);
                        highLfo.start(startTime);

                        lowBand.connect(lowPanner);
                        midBand.connect(midPanner);
                        highBand.connect(highPanner);

                        lowPanner.connect(finalDestination);
                        midPanner.connect(finalDestination);
                        highPanner.connect(finalDestination);

                        const dryGain = ctx.context.createGain();
                        dryGain.gain.value = 1.0 - ctx.spectralPanDepth;
                        dryGain.connect(finalDestination);

                        wetGain = ctx.context.createGain();
                        wetGain.gain.value = ctx.spectralPanDepth;
                        wetGain.connect(lowBand);
                        wetGain.connect(midBand);
                        wetGain.connect(highBand);

                        spectralFinalDest = dryGain;

                        source.addEventListener("ended", () => {
                            try { lowLfo.stop(); } catch(e){}
                            try { midLfo.stop(); } catch(e){}
                            try { highLfo.stop(); } catch(e){}
                        });
                    }

                    if (ctx.params.pan !== undefined && ctx.params.pan !== 0) {
                        const panner = ctx.context.createStereoPanner();
                        panner.pan.value = ctx.params.pan;
                        panner.connect(finalDestination);
                        finalDestination = panner;
                    }

                    source.connect(filter);
                    if (finalShaperDest) {
                        filter.connect(finalShaperDest);
                        finalShaperDest.connect(gain);
                    } else {
                        filter.connect(gain);
                    }

                    if (wetGain) {
                        gain.connect(spectralFinalDest);
                        gain.connect(wetGain);
                    } else {
                        gain.connect(spectralFinalDest);
                    }

                    source.start(startTime);
                    if (duration > 0) {
                        source.stop(startTime + duration);
                    }
                }

export const useAudioEngine = (pyodide: unknown, tempo: number = 120) => {
    const [isReady, setIsReady] = useState(false);
    const [audioEngine, setAudioEngine] = useState<AudioEngine | null>(null);
    const isInitializing = useRef(false);

    // Polyphonic TTS Manager
    const singingVoiceManagerRef = useRef<SingingVoiceManager | null>(null);
    const drumKitEngineRef = useRef<DrumKitEngine | null>(null);
    const synthABusRef = useRef<GainNode | null>(null);
    const prophecyManagerRef = useRef<ProphecyManager | null>(null);


    // Pre-stretched phoneme buffer pool (phoneme-aware time stretching)
    const phonemeBufferPoolRef = useRef<PhonemeBufferPool | null>(null);

    // Harmonizer for layered vocals
    const harmonizerRef = useRef<Harmonizer | null>(null);

    // Left/Right Choir Panning
    const choirLeftGainRef = useRef<GainNode | null>(null);
    const choirRightGainRef = useRef<GainNode | null>(null);
    const choirLeftPannerRef = useRef<StereoPannerNode | null>(null);
    const choirRightPannerRef = useRef<StereoPannerNode | null>(null);

    const sustainNodeRef = useRef<AudioWorkletNode | null>(null);
    const noiseBufferRef = useRef<AudioBuffer | null>(null);
    const ambianceSourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
    const ambianceGainNodeRef = useRef<GainNode | null>(null);
    const loadedAmbianceBuffersRef = useRef<Map<string, AudioBuffer>>(new Map());
    const gpuEngineRef = useRef<WebGpuOscillator | null>(null);
    const wasmEngineRef = useRef<WasmOscillator | null>(null);
    const open303ManagerRef = useRef<Open303Manager | null>(null);

    // Voice Managers
    const voiceManagerARef = useRef<VoiceManager | null>(null);
    const voiceManagerBRef = useRef<VoiceManager | null>(null);

    // Native WAV buffers
    const wavSawBufferRef = useRef<AudioBuffer | null>(null);
    const wavSqrBufferRef = useRef<AudioBuffer | null>(null);

    // Master Volume & Pan
    const masterGainRef = useRef<GainNode | null>(null);
    const masterSaturationRef = useRef<WaveShaperNode | null>(null);
    const sidechainGainRef = useRef<BiquadFilterNode | null>(null);
    const bassSidechainEQBusRef = useRef<BiquadFilterNode | null>(null);
    const sidechainBusRef = useRef<GainNode | null>(null);
    const masterCompressorRef = useRef<DynamicsCompressorNode | null>(null);
    const reverbNodesRef = useRef<Record<string, ConvolverNode>>({});
    const reverbNodeRef = useRef<ConvolverNode | null>(null); // Keep for backwards compatibility if needed temporarily
    const reverbTypeRef = useRef<'room' | 'plate' | 'hall'>('plate');
    const delayNodeRef = useRef<DelayNode | null>(null);
    const delayFeedbackRef = useRef<GainNode | null>(null);
    const masterPannerRef = useRef<StereoPannerNode | null>(null);

    const pyodideRef = useRef(pyodide);

    // Live note tracking
    const nextSynthNoteId = useRef(1);
    const activeSynthNotes = useRef(new Map<number, { stop: () => void }>());
    const nextSamplerNoteId = useRef(1);
    const activeSamplerNotes = useRef(new Map<number, { source: AudioBufferSourceNode; envGain: GainNode }>());

    const loadedSampleBuffersRef = useRef<Map<string, AudioBuffer>>(new Map());
    const vocalAlignmentsRef = useRef<Map<string, AlignmentResult>>(new Map());

    // Multisample Generator
    const multisampleGeneratorRef = useRef<MultisampleGenerator | null>(null);
    const multisampleBanksRef = useRef<Map<string, MultisampleBank>>(new Map());

    const playbackRefs = useMemo<PlaybackRefs>(() => ({
        masterGainRef,
        masterSaturationRef,
        masterCompressorRef,
        reverbNodesRef,
        reverbTypeRef,
        delayNodeRef,
        delayFeedbackRef,
        masterPannerRef,
        noiseBufferRef,
        open303ManagerRef,
        voiceManagerARef,
        voiceManagerBRef,
        nextSynthNoteId,
        activeSynthNotes,
        activeSamplerNotes,
        ambianceSourceNodeRef,
        ambianceGainNodeRef,
        loadedAmbianceBuffersRef,
        singingVoiceManagerRef,
        harmonizerRef,
        sidechainGainRef,
        bassSidechainEQBusRef,
        sidechainBusRef,
        drumKitEngineRef,
        synthABusRef,
        prophecyManagerRef,
    }), []);

    useEffect(() => {
        pyodideRef.current = pyodide;
    }, [pyodide]);

    const initializeAudio = useCallback(async () => {
        if (audioEngine || isInitializing.current) return;
        isInitializing.current = true;

        try {
            const audioWindow = window as AudioWindow;
            const AudioContextCtor = audioWindow.AudioContext ?? audioWindow.webkitAudioContext;
            if (!AudioContextCtor) {
                throw new Error('AudioContext is not available in this browser');
            }
            const context = new AudioContextCtor();
            audioWindow.audioContext = context;

            // --- CRITICAL FIX: Ensure AudioContext is running ---
            if (context.state === 'suspended') {
                await context.resume();
                console.log("AudioContext resumed");
            }

            const masterBusInput = initializeMasterOutput(context, masterGainRef, masterPannerRef, masterSaturationRef, masterCompressorRef, sidechainGainRef, bassSidechainEQBusRef);

            // Initialize Reverb Node
            // Initialize Reverb Nodes (Room, Plate, Hall)
            const roomNode = context.createConvolver();
            roomNode.buffer = createReverbImpulseResponse(context, 0.5, 1.0);
            roomNode.connect(masterBusInput);

            const plateNode = context.createConvolver();
            plateNode.buffer = createReverbImpulseResponse(context, 1.5, 2.0);
            plateNode.connect(masterBusInput);

            const hallNode = context.createConvolver();
            hallNode.buffer = createReverbImpulseResponse(context, 3.5, 3.0);
            hallNode.connect(masterBusInput);

            reverbNodesRef.current = { room: roomNode, plate: plateNode, hall: hallNode };
            reverbNodeRef.current = plateNode; // Fallback

            // Initialize Global Delay Node
            const delayNode = context.createDelay(2.0);
            delayNode.delayTime.value = 0.375; // ~1/8th note at typical tempo
            const delayFeedback = context.createGain();
            delayFeedback.gain.value = 0.4;
            delayNode.connect(delayFeedback);
            delayFeedback.connect(delayNode);
            delayNode.connect(masterBusInput);
            delayNodeRef.current = delayNode;
            delayFeedbackRef.current = delayFeedback;

            // Initialize Engines
            const gpuEngine = new WebGpuOscillator();
            await gpuEngine.init().catch(e => console.warn("GPU Engine init failed", e));
            gpuEngineRef.current = gpuEngine;

            const wasmEngine = new WasmOscillator();
            await wasmEngine.init().catch(e => console.warn("WASM Engine init failed", e));
            wasmEngineRef.current = wasmEngine;

            // Initialize Open303 Manager
            const open303Manager = new Open303Manager();
            let open303Ready = false;

            try {
                open303Ready = await open303Manager.init(context, open303ProcessorUrl, {
                    preferWorklet: true,
                    preferThreaded: false,
                    forceSingleThreaded: true
                });

                if (open303Ready) {
                    open303Manager.connect(masterBusInput);
                    open303ManagerRef.current = open303Manager;
                    console.log('[useAudioEngine] Open303Manager Ready');
                    try { engineTelemetry.registerResolution('jc303','open303','ready'); } catch (e) { /* noop */ }
                } else {
                    console.warn('[useAudioEngine] Open303Manager failed to initialize');
                    try { engineTelemetry.registerResolution('jc303','fallback','notReady'); } catch (e) { /* noop */ }
                }
            } catch (e) {
                console.error('[useAudioEngine] Open303Manager crashed during init:', e);
                open303Ready = false;
            }

            if (!open303Ready) {
                console.log('[useAudioEngine] Open303 bypassed - using fallback bass synthesis');
            }

            const [sawBuf, sqrBuf] = await Promise.all([
                loadWavBuffer(context, './assets/saw.wav'),
                loadWavBuffer(context, './assets/square.wav')
            ]);
            wavSawBufferRef.current = sawBuf;
            wavSqrBufferRef.current = sqrBuf;

            // Register oscillator backend decision (webgpu -> wasm -> wav -> js)
            try {
                let oscillatorBackend = 'js';
                if (gpuEngine && (gpuEngine as any).isSupported) oscillatorBackend = 'webgpu';
                else if (wasmEngine && (wasmEngine as any).isReady) oscillatorBackend = 'wasm';
                else if (sawBuf || sqrBuf) oscillatorBackend = 'wav';
                engineTelemetry.registerResolution('oscillators', oscillatorBackend, 'init-decision');
            } catch (e) {
                console.warn('Engine telemetry registration failed for oscillators', e);
            }

            // Initialize Voice Managers
            voiceManagerARef.current = new VoiceManager(context, masterSaturationRef.current!, 8, false, sawBuf || undefined, sqrBuf || undefined, delayNodeRef.current || undefined);
            voiceManagerBRef.current = new VoiceManager(context, masterSaturationRef.current!, 1, true, sawBuf || undefined, sqrBuf || undefined, delayNodeRef.current || undefined);

            await initializeSustainProcessor(context, sustainProcessorUrl, sustainNodeRef, masterGainRef);

            // --- Singing Voice Manager Init ---
            try {
                let wasmBinary: ArrayBuffer | undefined = undefined;
                try {
                    const response = await fetch(import.meta.env.BASE_URL + 'rubberband.wasm');
                    if (response.ok) wasmBinary = await response.arrayBuffer();
                } catch (e) {
                    console.warn('Failed to pre-fetch rubberband.wasm', e);
                }

                const manager = new SingingVoiceManager(context, 12, {
                    useHighQuality: false,
                    preserveFormants: true,
                    channels: 1,
                    bufferSize: 16384,
                    enablePhonemeStretching: true,
                    enableFormantShifting: true
                });

                await manager.init(wasmBinary);
                singingVoiceManagerRef.current = manager;
                try { engineTelemetry.registerResolution('singingVoice','wasm','loaded'); } catch (e) { /* noop */ }

                initializeChoirBuses(
                    context,
                    masterGainRef,
                    choirLeftGainRef,
                    choirRightGainRef,
                    choirLeftPannerRef,
                    choirRightPannerRef,
                );

                manager.getAllVoices().forEach(voice => {
                    voice.connectOutput(masterSaturationRef.current!);
                });

                // Initialise the phoneme buffer pool and wire it to every voice
                const pool = new PhonemeBufferPool();
                pool.init(context);
                phonemeBufferPoolRef.current = pool;
                manager.getAllVoices().forEach(voice => voice.setPool(pool));

                if (pyodideRef.current) {
                    // Pre-cache logic
                }
            } catch (e) {
                try { engineTelemetry.registerResolution('singingVoice','js','failed to init: ' + String(e)); } catch (err) { /* noop */ }
                console.warn('SingingVoiceManager failed to init:', e);
            }

            initializeHarmonizer(harmonizerRef);
            noiseBufferRef.current = createNoiseBuffer(context);
            multisampleGeneratorRef.current = new MultisampleGenerator(context);

            // --- Helper: warm the phoneme pool for all phonemes in a bank ---
            const warmPoolForBank = (sampleName: string, alignment: AlignmentResult, audioBuffer: AudioBuffer): void => {
                const pool = phonemeBufferPoolRef.current;
                if (!pool) return;
                const monoAudio = audioBuffer.getChannelData(0);
                const sr = audioBuffer.sampleRate;
                for (let i = 0; i < alignment.phonemes.length; i++) {
                    const ph = alignment.phonemes[i];
                    const startSample = Math.floor(ph.start * sr);
                    const endSample = Math.floor(ph.end * sr);
                    if (endSample <= startSample) continue;
                    const slice = monoAudio.slice(startSample, endSample);
                    pool.warmPhoneme(`${sampleName}_${i}`, [slice], sr);
                }
            };

            // --- Playback Functions Extraction ---
            const playSynth = (params: any, note: string | string[], time: number, durationSteps?: number, stepTime?: number, slideFromFreq?: number, track?: 'partA' | 'partB' | 'bass2', noteParams?: any) => {
                createPlaySynth(context, playbackRefs)(params, note, time, durationSteps, stepTime, slideFromFreq, track as any, noteParams);
            };
            const playDrum = createPlayDrum(context, playbackRefs) as any;
            const {
                loadSampleToEngine,
                getMultisampleBank,
                isMultisampleReady,
                prepareVocal: prepareVocalBase,
                getAlignment,
                setAlignment: setAlignmentBase
            } = createSampleLibraryControls({
                loadedSampleBuffersRef,
                multisampleBanksRef,
                multisampleGeneratorRef,
                vocalAlignmentsRef,
                singingVoiceManagerRef,
            });

            // Wrap prepareVocal to warm the pool once alignment is computed
            const prepareVocal = async (bankIndex: number, text: string): Promise<void> => {
                await prepareVocalBase(bankIndex, text);
                const sampleName = `bank_${bankIndex}`;
                const alignment = vocalAlignmentsRef.current.get(sampleName);
                const audioBuffer = (multisampleBanksRef.current.get(sampleName)?.baseBuffer)
                    ?? loadedSampleBuffersRef.current.get(sampleName);
                if (alignment && audioBuffer) {
                    warmPoolForBank(sampleName, alignment, audioBuffer);
                }
            };

            // Wrap setAlignment to warm the pool when alignment is set externally
            const setAlignment = (bankIndex: number, alignment: AlignmentResult | null): void => {
                setAlignmentBase(bankIndex, alignment);
                if (alignment) {
                    const sampleName = `bank_${bankIndex}`;
                    const audioBuffer = (multisampleBanksRef.current.get(sampleName)?.baseBuffer)
                        ?? loadedSampleBuffersRef.current.get(sampleName);
                    if (audioBuffer) {
                        warmPoolForBank(sampleName, alignment, audioBuffer);
                    }
                }
            };
            const playSamplerVoice = (
                params: SamplerBankParams,
                note: string | string[],
                time: number,
                durationSteps: number = 1,
                stepTime: number = 0.2,
                noteParams?: {
                    timbre?: number,
                    microtiming?: number,
                    reverse?: boolean,
                    sliceIndex?: number,
                    retrigger?: number,
                    slideFromMidi?: number,
                    slideType?: 'linear' | 'exponential',
                    phonemes?: PhonemeData[],
                    freeze?: number,
                    filterCutoff?: number,
                    filterResonance?: number,
                    formantLfoRate?: number,
                    formantLfoDepth?: number,
                    formantLfoShape?: number[],
                    customLfoShape?: number[],
                    vibratoDepth?: number,
                    reverbSend?: number,
                    delaySend?: number,
                    choir?: number,
                    drive?: number,
                    characterMorph?: number,
                    breathIntensity?: number,
                    formantShift?: number,
                    grainPitchQuantize?: number,
                    tranceGate?: number
                    gateRate?: number,
                    gateDepth?: number
                },
                pitchOffsetSemitones: number = 0,
                tuning?: ScaleDefinition | null
            ) => {
                const multisampleBank = multisampleBanksRef.current.get(params.sampleName);
                const legacyBuffer = loadedSampleBuffersRef.current.get(params.sampleName);
                const buffer = multisampleBank?.baseBuffer || legacyBuffer;

                if (!buffer || !masterSaturationRef.current) return;

                // Apply Microtiming
                const actualTime = time + (noteParams?.microtiming ? noteParams.microtiming * stepTime : 0);

                // Retrigger Logic
                const retrigger = Math.max(1, Math.floor(noteParams?.retrigger || 1));
                const subDurationSteps = durationSteps / retrigger;

                // --- GLITCH LOGIC START ---
                const shouldGlitch = retrigger === 1 && (params.glitchChance || 0) > 0 && Math.random() < (params.glitchChance || 0);
                // --- GLITCH LOGIC END ---

                // Handle Polyphony (Chords)
                const notes = Array.isArray(note) ? note : [note];

                // Performance: Hoist expressive config resolution to avoid recalculating per note/retrigger.
                const expressiveConfig = resolveExpressiveness(params);

                // --- HOISTED PARAMETERS START ---
                // Vocoder Mix
                const vocoderMix = noteParams?.vocoderMix ?? params.vocoderMix ?? 0;
                const pVocoderFormantShift = noteParams?.vocoderFormantShift ?? params.formantShift ?? 0;
                const pVocoderPreservation = noteParams?.vocoderPreservation ?? 1.0;
                const pVocoderAttack = noteParams?.vocoderAttack ?? 0.01;
                const pVocoderRelease = noteParams?.vocoderRelease ?? 0.05;

                // Spectral Panning
                const spectralPanRate = noteParams?.spectralPanRate !== undefined ? noteParams.spectralPanRate : (params as any).spectralPanRate;
                const spectralPanDepth = noteParams?.spectralPanDepth !== undefined ? noteParams.spectralPanDepth : (params as any).spectralPanDepth;
                const spectralPanLfoRate = (spectralPanRate || 1) * (tempo / 60);

                // Reverb
                const reverbSendAmount = noteParams?.reverbSend !== undefined ? noteParams.reverbSend : 0;
                const currentReverbType = (noteParams as any)?.reverbType || reverbTypeRef.current;
                const targetReverbNode = reverbNodesRef.current[currentReverbType] || reverbNodesRef.current['plate'];

                const baseShift = params.formantShift || 0;
                const currentShift = noteParams?.formantShift !== undefined ? (baseShift + noteParams.formantShift) : baseShift;
                const characterMorph = noteParams?.characterMorph !== undefined ? noteParams.characterMorph : (params.characterMorph ?? 0);
                const morphTarget = params.morphTarget || 'female';

                const normalizedShift = Math.max(-12, Math.min(12, currentShift)) / 12;
                let reverbEqCutoff = 6000 - (normalizedShift * 4000);
                reverbEqCutoff -= (characterMorph * 1000);
                reverbEqCutoff = Math.max(1000, Math.min(12000, reverbEqCutoff));

                const revLfoRate = noteParams?.reverbLfoRate !== undefined ? noteParams.reverbLfoRate : (params.reverbLfoRate || 0.1);
                const revLfoDepth = noteParams?.reverbLfoDepth !== undefined ? noteParams.reverbLfoDepth : (params.reverbLfoDepth || 0);

                // Delay
                const delaySendAmount = noteParams?.delaySend !== undefined ? noteParams.delaySend : (params.delaySend || 0);

                // Timbre Modulation
                let targetFormantShift = baseShift;
                if (noteParams?.formantShift !== undefined) {
                    targetFormantShift = baseShift + noteParams.formantShift;
                } else if (noteParams?.timbre !== undefined) {
                    targetFormantShift = baseShift + (noteParams.timbre * 12) - 6;
                }
                const startFormantShift = noteParams?.slideFromFormant !== undefined ? (baseShift + noteParams.slideFromFormant) : undefined;

                // General Params
                const pVibratoDepth = noteParams?.vibratoDepth;
                const pGateDepth = noteParams?.gateDepth !== undefined ? noteParams.gateDepth : params.gateDepth;
                const pGateRateHz = noteParams?.gateRate !== undefined
                    ? (tempo / 60) * (noteParams.gateRate / 4)
                    : (params.gateRate !== undefined ? (tempo / 60) * (params.gateRate / 4) : undefined);
                const pAttack = params.attack;
                const pDecay = params.decay;
                const pSustain = params.sustain;
                const pRelease = params.release;

                // Freeze
                const pFreeze = noteParams?.freeze !== undefined ? noteParams.freeze : params.freeze;
                const freezeRateSync = noteParams?.freezeLfoSync !== undefined ? noteParams.freezeLfoSync : params.freezeLfoSync;
                let pFreezeLfoRate: number | undefined;
                if (noteParams?.freezeLfoRate !== undefined) {
                    pFreezeLfoRate = freezeRateSync ? getSyncedLfoHz(noteParams.freezeLfoRate, tempo) : noteParams.freezeLfoRate;
                } else if (params.freezeLfoRate !== undefined) {
                    pFreezeLfoRate = freezeRateSync ? getSyncedLfoHz(params.freezeLfoRate, tempo) : params.freezeLfoRate;
                }
                const pFreezeLfoDepth = noteParams?.freezeLfoDepth !== undefined ? noteParams.freezeLfoDepth : params.freezeLfoDepth;

                // Envelopes
                const pFreezeEnvDepth = noteParams?.freezeEnvDepth !== undefined ? noteParams.freezeEnvDepth : params.freezeEnvDepth;
                const pTimeStretchEnvDepth = noteParams?.timeStretchEnvDepth !== undefined ? noteParams.timeStretchEnvDepth : params.timeStretchEnvDepth;
                const pGrainEnvDepth = noteParams?.grainEnvDepth !== undefined ? noteParams.grainEnvDepth : params.grainEnvDepth;
                const pGrainPitchEnvDepth = (noteParams as any)?.grainPitchEnvDepth !== undefined ? (noteParams as any).grainPitchEnvDepth : params.grainPitchEnvDepth;
                const pGrainJitter = (noteParams as any)?.grainJitter !== undefined ? (noteParams as any).grainJitter : params.grainJitter;
                const pGrainPitchQuantize = noteParams?.grainPitchQuantize !== undefined ? noteParams.grainPitchQuantize : params.grainPitchQuantize;

                // Effects
                const pGranularPitchShift = noteParams?.granularPitchShift !== undefined ? noteParams.granularPitchShift : params.granularPitchShift;
                const pBitcrush = noteParams?.bitcrush !== undefined ? noteParams.bitcrush : params.bitcrush;
                const pDownsample = noteParams?.downsample !== undefined ? noteParams.downsample : params.downsample;
                const pTranceGate = noteParams?.tranceGate;

                // Formant LFO
                const useFmtLfoSync = noteParams?.formantLfoSync ?? params.formantLfoSync ?? false;
                const rawFmtLfoRate = noteParams?.formantLfoRate !== undefined ? noteParams.formantLfoRate : params.formantLfoRate;
                const pFormantLfoRateHz = rawFmtLfoRate !== undefined ? (useFmtLfoSync ? ((tempo / 60) / (rawFmtLfoRate * 4)) : rawFmtLfoRate) : undefined;
                const pFormantLfoDepth = noteParams?.formantLfoDepth !== undefined ? noteParams.formantLfoDepth : params.formantLfoDepth;
                let pFormantLfoShape = noteParams?.customLfoShape !== undefined ? noteParams.customLfoShape : params.customLfoShape;
                if (pFormantLfoShape === undefined) {
                    pFormantLfoShape = noteParams?.formantLfoShape !== undefined ? noteParams.formantLfoShape : params.formantLfoShape;
                }

                // Formant Envelope
                const envSync = noteParams?.formantEnvSync ?? params.formantEnvSync ?? false;
                let pEnvAttack = noteParams?.formantEnvAttack ?? params.formantEnvAttack ?? 0;
                let pEnvDecay = noteParams?.formantEnvDecay ?? params.formantEnvDecay ?? 0;
                const pEnvAmount = noteParams?.formantEnvAmount ?? params.formantEnvAmount ?? 0;
                const pFormantEnvFollower = noteParams?.formantEnvFollower ?? params.formantEnvFollower ?? 0;
                if (envSync) {
                    pEnvAttack = getSyncedSeconds(pEnvAttack as number, tempo);
                    pEnvDecay = getSyncedSeconds(pEnvDecay as number, tempo);
                }

                const pPitchAttack = (noteParams as any)?.pitchAttack ?? params.pitchAttack ?? 0;
                const pPitchDecay = (noteParams as any)?.pitchDecay ?? params.pitchDecay ?? 0;
                const pPitchAmount = (noteParams as any)?.pitchAmount ?? params.pitchAmount ?? 0;

                const pFilterCutoff = noteParams?.filterCutoff !== undefined
                    ? Math.max(20, noteParams.filterCutoff * 20000)
                    : params.filterCutoff;
                const pFilterResonance = noteParams?.filterResonance !== undefined
                    ? noteParams.filterResonance * 20
                    : params.filterResonance;
                const pDriveAmount = noteParams?.drive !== undefined
                    ? noteParams.drive
                    : params.drive;
                const ctx: SamplerVoiceContext = {
                    context,
                    params,
                    noteParams,
                    actualTime,
                    durationSteps,
                    stepTime,
                    buffer,
                    multisampleBank,
                    pitchOffsetSemitones,
                    expressiveConfig,
                    pFilterCutoff,
                    pFilterResonance,
                    pDriveAmount,
                    vocoderMix,
                    pVocoderFormantShift,
                    pVocoderPreservation,
                    pVocoderAttack,
                    pVocoderRelease,
                    spectralPanLfoRate,
                    spectralPanDepth,
                    targetReverbNode,
                    reverbSendAmount,
                    reverbEqCutoff,
                    revLfoRate,
                    revLfoDepth,
                    delaySendAmount,
                    targetFormantShift,
                    startFormantShift,
                    pVibratoDepth,
                    pGateDepth,
                    pGateRateHz,
                    pAttack,
                    pDecay,
                    pSustain,
                    pRelease,
                    pFreeze,
                    pFreezeLfoRate,
                    pFreezeLfoDepth,
                    pFreezeEnvDepth,
                    pTimeStretchEnvDepth,
                    pGrainEnvDepth,
                    pGrainPitchEnvDepth,
                    pGrainJitter,
                    pGrainPitchQuantize,
                    pGranularPitchShift,
                    pBitcrush,
                    pDownsample,
                    pTranceGate,
                    pFormantLfoRateHz,
                    pFormantLfoDepth,
                    pFormantLfoShape,
                    pEnvAttack,
                    pEnvDecay,
                    pEnvAmount,
                    pFormantEnvFollower,
                    pPitchDecay,
                    pPitchAmount,
                    characterMorph,
                    morphTarget,
                    alignment: vocalAlignmentsRef.current.get(params.sampleName),
                    tuning,
                    manager: singingVoiceManagerRef.current,
                    refs: {
                        masterGainRef,
                        masterSaturationRef,
                        delayNodeRef,
                        reverbNodesRef,
                        reverbTypeRef,
                        vocalOverdrivePoolRef,
                        expressiveVoiceProcessorPoolRef,
                        singingVoiceManagerRef,
                        harmonyBusGainRef,
                        synthABusRef,
                        choirLeftGainRef,
                        choirRightGainRef,
                    }
                };

                // --- HOISTED PARAMETERS END ---

                // If Singing/Stretch Mode
                if (params.mode === 'stretch' && singingVoiceManagerRef.current) {
                    const manager = singingVoiceManagerRef.current;
                    const alignment = vocalAlignmentsRef.current.get(params.sampleName);

                    // For each note in the chord
;

;
                    notes.forEach((noteStr, _noteIndex) => {

                        if (shouldGlitch) {
                            const numStutters = Math.floor(Math.random() * 3) + 2;
                            const totalDur = durationSteps * stepTime;
                            const stutterLen = Math.min(0.06, totalDur / numStutters);

                            for (let i = 0; i < numStutters; i++) {
                                runVoices(ctx, noteStr, i * stutterLen, stutterLen);
                            }
                            const played = numStutters * stutterLen;
                            if (totalDur > played) {
                                runVoices(ctx, noteStr, played, totalDur - played);
                            }
                        } else {
                            for (let r = 0; r < retrigger; r++) {
                                const offset = r * (subDurationSteps * stepTime);
                                runVoices(ctx, noteStr, offset, subDurationSteps * stepTime);
                            }
                        }
                    });
                    return;
                }

                // Buffer playback mode (non-stretch)
;

                notes.forEach(noteStr => {
                    const midi = noteToMidi(noteStr);

                    if (shouldGlitch) {
                        const numStutters = Math.floor(Math.random() * 3) + 2;
                        const stutterLen = 0.06;

                        for (let i = 0; i < numStutters; i++) {
                            playBufferSource(ctx, actualTime + i * stutterLen, stutterLen, midi);
                        }
                        playBufferSource(ctx, actualTime + numStutters * stutterLen, 0, midi);
                    } else {
                        for (let r = 0; r < retrigger; r++) {
                            const offset = r * (subDurationSteps * stepTime);
                            playBufferSource(ctx, actualTime + offset, subDurationSteps * stepTime, midi);
                        }
                    }
                });
            };

            // Main playSampler function with harmonizer support
            const playSampler = (
                params: SamplerBankParams,
                note: string | string[],
                time: number,
                durationSteps: number = 1,
                stepTime: number = 0.2,
                tuning?: ScaleDefinition | null
            ) => {
                // Harmonize support - if harmonizer is active, generate multiple harmony voices
                const harmonizer = harmonizerRef.current;
                if (harmonizer?.getIsActive()) {
                    const voices = harmonizer.generateVoices();

                    // Play base voice (index 0) - the original note
                    playSamplerVoice(params, note, time, durationSteps, stepTime, undefined, 0, tuning);

                    // Play each harmony voice (skip index 0 which is base)
                    voices.forEach((voice) => {
                        if (voice.index === 0) return; // Skip base voice, already played above

                        // Create modified params for this harmony voice
                        const voiceParams: SamplerBankParams = {
                            ...params,
                            pan: voice.pan,
                            volume: params.volume * voice.gain * 0.85,
                            formantShift: (params.formantShift || 0) + voice.formantShift,
                            fineTune: (params.fineTune || 0) + voice.detuneCents
                        };

                        // Play this voice with pitch offset and slight delay for natural ensemble effect
                        const delayMs = voice.index * 5;
                        setTimeout(() => {
                            playSamplerVoice(voiceParams, note, time + (delayMs / 1000), durationSteps, stepTime, undefined, voice.pitchOffset, tuning);
                        }, delayMs);
                    });
                    return;
                }

                playSamplerVoice(params, note, time, durationSteps, stepTime, undefined, 0, tuning);
            };

            const noteOnSampler = (params: SamplerBankParams, note: string, time?: number, tuning?: any): number | null => {
                const now = time || context.currentTime;

                const multisampleBank = multisampleBanksRef.current.get(params.sampleName);
                const legacyBuffer = loadedSampleBuffersRef.current.get(params.sampleName);
                const buffer = multisampleBank?.baseBuffer || legacyBuffer;

                if (!buffer || !masterSaturationRef.current) return null;

                const rootNote = params.rootNote ?? 60;
                const coarseTune = params.coarseTune ?? 0;
                const fineTune = params.fineTune ?? 0;

                const targetMidi = noteToMidi(note);
                const source = context.createBufferSource();

                let playbackBuffer: AudioBuffer;
                let pitchRatio: number;

                if (multisampleBank?.pitchBank.has(targetMidi)) {
                    playbackBuffer = multisampleBank.pitchBank.get(targetMidi)!;
                    pitchRatio = params.playbackSpeed;
                } else {
                    playbackBuffer = multisampleBank?.baseBuffer || buffer;
                    const rootMidi = multisampleBank?.rootNote ?? rootNote;
                    const effectivePitchOffset = coarseTune + (fineTune / 100);
                    pitchRatio = params.playbackSpeed * Math.pow(2, (targetMidi - rootMidi + effectivePitchOffset) / 12);
                }

                source.buffer = playbackBuffer;
                source.playbackRate.value = pitchRatio;

                const gain = context.createGain();
                gain.gain.value = params.volume;

                source.connect(gain);
                gain.connect(masterSaturationRef.current);
                source.start(now);

                const id = nextSamplerNoteId.current++;
                activeSamplerNotes.current.set(id, { source, envGain: gain });
                return id;
            };

            const noteOffSampler = (id: number) => {
                const note = activeSamplerNotes.current.get(id);
                if (note) {
                    const now = context.currentTime;
                    note.envGain.gain.cancelScheduledValues(now);
                    note.envGain.gain.linearRampToValueAtTime(0, now + 0.1);
                    note.source.stop(now + 0.1);
                    activeSamplerNotes.current.delete(id);
                }
            };

            const noteOnSynth = createNoteOnSynth(context, playbackRefs);
            const noteOffSynthById = (id: number) => noteOffSynth(activeSynthNotes.current, id);
            const stopAllNotes = createStopAllNotes(playbackRefs);

            const renderSynthPartToBuffer = (_params: SynthParams, _sequence: PartSequence, _tempo: number): Promise<AudioBuffer> => {
                 return Promise.resolve(context.createBuffer(2, context.sampleRate * 2, context.sampleRate));
            };

            const playBufferedPart = (buffer: AudioBuffer, time: number) => {
                const src = context.createBufferSource();
                src.buffer = buffer;
                src.connect(masterSaturationRef.current!);
                src.start(time);
            };
            const { playAmbiance, stopAmbiance, setAmbianceVolume } = createAmbianceControls(context, playbackRefs);
            const setMasterVolume = (value: number) => setMasterGainVolume(masterGainRef, value);
            const setMasterSaturation = (amount: number) => setMasterGainSaturation(masterSaturationRef, amount);
            const setGlobalPan = (value: number) => setMasterPan(masterPannerRef, value);

            const setReverbType = (type: 'room' | 'plate' | 'hall') => {
                reverbTypeRef.current = type;
            };

            const triggerTapeStop = (duration: number = 2.0) => {
                if (!masterGainRef.current) return;
                const now = context.currentTime;
                const gain = masterGainRef.current.gain;
                const currentVol = gain.value;
                gain.cancelScheduledValues(now);
                gain.setValueAtTime(currentVol, now);
                gain.exponentialRampToValueAtTime(0.0001, now + duration);
            };

            const resetTapeStop = () => {
                if (!masterGainRef.current) return;
                const now = context.currentTime;
                const gain = masterGainRef.current.gain;
                gain.cancelScheduledValues(now);
                gain.setValueAtTime(1.0, now);
            };

            const detectSamplePitch = async (_b: AudioBuffer) => null;
            const processSinging = async (_sampleName: string, _note: string, _steps: number, _tempo: number) => null;
            const processSpoon = async (_sampleName: string, _note: string) => null;
            const setSustainMode = (_mode: 'loop' | 'stretch' | 'wavetable') => {};
            const setSustainGrainSize = (_size: number) => {};
            const setHarmonizerConfig = (config: HarmonizerConfig, isActive: boolean) => applyHarmonizerConfig(harmonizerRef, config, isActive);
            const updateSamplerVoiceParams = (_bankIdx: number, _key: string, _value: number | string | boolean) => {};

            // Re-assign to state
            setAudioEngine({
                context,
                webGpuEngine: gpuEngineRef.current,
                wasmEngine: wasmEngineRef.current,
                open303Engine: open303ManagerRef.current as any,
                singingVoice: undefined,
                playSynth,
                playDrum,
                playSampler,
                noteOnSampler,
                noteOffSampler,
                noteOnSynth,
                noteOffSynth: noteOffSynthById,
                stopAllNotes,
                loadSampleToEngine,
                renderSynthPartToBuffer,
                playBufferedPart,
                playAmbiance,
                stopAmbiance,
                setAmbianceVolume,
                setMasterVolume,
                setMasterSaturation,
                setGlobalPan,
                setReverbType,
                detectSamplePitch,
                processSinging,
                processSpoon,
                prepareVocal,
                getAlignment,
                setAlignment,
                setSustainMode,
                setSustainGrainSize,
                getMultisampleBank,
                isMultisampleReady,
                setHarmonizerConfig,
                updateSamplerVoiceParams,
                triggerTapeStop,
                resetTapeStop
            });

            setIsReady(true);
        } } } catch (e) {
            console.error("CRITICAL AUDIO INIT FAILURE", e);
            setIsReady(true);
            isInitializing.current = false;
        }
    }, [audioEngine, playbackRefs]);

    const updateVoiceParams = useCallback((_bankIdx: number, key: keyof SamplerBankParams, value: number, rampTime?: number) => {
        applyVoiceParamUpdate({
            manager: singingVoiceManagerRef.current,
            choirLeftGain: choirLeftGainRef.current,
            choirRightGain: choirRightGainRef.current,
            currentTime: audioEngine?.context.currentTime || 0,
            key,
            value,
            rampTime
        });
    }, [audioEngine]);

    const updateSamplerVoiceParams = useCallback((_bankIdx: number, param: string, value: number | string | boolean) => {
        applySamplerVoiceParamUpdate({
            manager: singingVoiceManagerRef.current,
            currentTime: audioEngine?.context?.currentTime || 0,
            param,
            value,
        });
    }, [audioEngine]);

    return useMemo(() => ({
        audioEngine,
        isReady,
        initializeAudio,
        onParamChange: updateVoiceParams,
        updateSamplerVoiceParams,
        drumKitEngineRef
    }), [audioEngine, isReady, initializeAudio, updateVoiceParams, updateSamplerVoiceParams]);
};