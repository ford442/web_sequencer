import type { MutableRefObject } from 'react';
import type { AlignmentResult } from '../../engines/rubberband/PhonemeAligner';
import { SingingVoice } from '../../engines/SingingVoice';
import { SingingVoiceManager } from '../../engines/SingingVoiceManager';
import { Harmonizer } from '../../engines/Harmonizer';
import type { MultisampleBank, PhonemeData, SamplerBankParams } from '../../types';
import { noteToMidi, type ScaleDefinition } from '../../utils/musicTheory';
import { makeDistortionCurve } from './distortion';
import { pulseExpressionLed } from '../../audio/expressionLedPulse';
import { getSyncedLfoHz, getSyncedSeconds, resolveExpressiveness } from './syncUtils';
import { performanceBudget } from '../../utils/performanceBudget';


export interface SamplerVoiceContext {
    buffer: AudioBuffer;
    params: SamplerBankParams;
    noteParams: SamplerNoteParams | undefined;
    actualTime: number;
    durationSteps: number;
    stepTime: number;
    pitchOffsetSemitones: number;
    tuning: ScaleDefinition | null | undefined;
    alignment: AlignmentResult | undefined;
    manager: SingingVoiceManager;

    // Hoisted values
    characterMorph: number;
    morphTarget: string;
    pVibratoDepth: number | undefined;
    pTremoloDepth: number | undefined;
    pTremoloRate: number | undefined;
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
    pEnvAmount: number;
    pEnvAttack: number;
    pEnvDecay: number;
    pFormantEnvFollower: number;
    pPitchAttack: number;
    pPitchDecay: number;
    pPitchAmount: number;
}

export interface SamplerNoteParams {
    timbre?: number;
    microtiming?: number;
    reverse?: boolean;
    sliceIndex?: number;
    retrigger?: number;
    slideFromMidi?: number;
    slideType?: 'linear' | 'exponential';
    phonemes?: PhonemeData[];
    freeze?: number;
    filterCutoff?: number;
    filterResonance?: number;
    formantLfoRate?: number;
    formantLfoDepth?: number;
    formantLfoShape?: number[];
    customLfoShape?: number[];
    vibratoDepth?: number;
    reverbSend?: number;
    delaySend?: number;
    choir?: number;
    drive?: number;
    characterMorph?: number;
    breathIntensity?: number;
    formantShift?: number;
    formantPitchLink?: number;
    coarseTune?: number;
    fineTune?: number;
    grainPitchQuantize?: number;
    tranceGate?: number;
    gateRate?: number;
    gateDepth?: number;
    vocoderMix?: number;
    vocoderFormantShift?: number;
    vocoderPreservation?: number;
    vocoderAttack?: number;
    vocoderRelease?: number;
    spectralPanRate?: number;
    spectralPanDepth?: number;
    reverbType?: 'room' | 'plate' | 'hall';
    reverbLfoRate?: number;
    reverbLfoDepth?: number;
    tremoloDepth?: number;
    tremoloRate?: number;
    freezeLfoSync?: boolean;
    freezeLfoRate?: number;
    freezeLfoDepth?: number;
    freezeEnvDepth?: number;
    timeStretchEnvDepth?: number;
    grainEnvDepth?: number;
    grainPitchEnvDepth?: number;
    grainJitter?: number;
    granularPitchShift?: number;
    bitcrush?: number;
    downsample?: number;
    formantLfoSync?: boolean;
    formantEnvSync?: boolean;
    formantEnvAttack?: number;
    formantEnvDecay?: number;
    formantEnvAmount?: number;
    formantEnvFollower?: number;
    formantSidechainDepth?: number;
    pitchAttack?: number;
    pitchDecay?: number;
    pitchAmount?: number;
    slideFromFormant?: number;
}

const playBufferSource = (
    context: AudioContext,
    multisampleBank: MultisampleBank | undefined,
    masterSaturationNode: AudioNode | null,
    startTime: number,
    duration: number,
    pitchSemitones: number,
    params: SamplerBankParams,
    noteParams?: SamplerNoteParams,
    buffer?: AudioBuffer
) => {
    const source = context.createBufferSource();

    const targetMidi = pitchSemitones;
    let playbackBuffer: AudioBuffer;
    let pitchRatio = 1.0;

    if (multisampleBank?.pitchBank.has(targetMidi)) {
        playbackBuffer = multisampleBank.pitchBank.get(targetMidi)!;
        pitchRatio = params.playbackSpeed;
    } else {
        playbackBuffer = multisampleBank?.baseBuffer || buffer!;
        const rootMidi = multisampleBank?.rootNote ?? 60;
        const speed = params.playbackSpeed;
        pitchRatio = speed * Math.pow(2, (targetMidi - rootMidi) / 12);
    }

    if (noteParams?.reverse) {
        // Reverse buffer inline for playBufferSource path (non-stretch)
        const reversedBuffer = context.createBuffer(playbackBuffer.numberOfChannels, playbackBuffer.length, playbackBuffer.sampleRate);
        for (let i = 0; i < playbackBuffer.numberOfChannels; i++) {
            const channelData = playbackBuffer.getChannelData(i);
            const reversedData = reversedBuffer.getChannelData(i);
            for (let j = 0; j < playbackBuffer.length; j++) {
                reversedData[j] = channelData[playbackBuffer.length - 1 - j];
            }
        }
        source.buffer = reversedBuffer;
    } else {
        source.buffer = playbackBuffer;
    }
    source.playbackRate.value = pitchRatio;

    const gain = context.createGain();
    gain.gain.value = params.volume;

    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    const cutoff = noteParams?.filterCutoff !== undefined
        ? Math.max(20, noteParams.filterCutoff * 20000)
        : params.filterCutoff;
    if (cutoff !== undefined) filter.frequency.value = cutoff;

    const resonance = noteParams?.filterResonance !== undefined
        ? noteParams.filterResonance * 20
        : params.filterResonance;
    if (resonance !== undefined) filter.Q.value = resonance;

    const shaper = context.createWaveShaper();
    const driveAmount = noteParams?.drive !== undefined ? noteParams.drive : params.drive;
    if (driveAmount !== undefined && driveAmount > 0) {
        shaper.curve = makeDistortionCurve(driveAmount * 100);
    } else {
        shaper.curve = null;
    }

    let finalDestination: AudioNode = masterSaturationNode!;
    if (params.pan !== undefined && params.pan !== 0) {
        const panner = context.createStereoPanner();
        panner.pan.value = params.pan;
        panner.connect(masterSaturationNode!);
        finalDestination = panner;
    }

    source.connect(filter);
    filter.connect(shaper);
    shaper.connect(gain);
    gain.connect(finalDestination);

    source.start(startTime);
    if (duration > 0) {
        source.stop(startTime + duration);
    }
};

export interface SamplerPlaybackRefs {
    masterSaturationRef: MutableRefObject<WaveShaperNode | null>;
    singingVoiceManagerRef: MutableRefObject<SingingVoiceManager | null>;
    vocalAlignmentsRef: MutableRefObject<Map<string, AlignmentResult>>;
    loadedSampleBuffersRef: MutableRefObject<Map<string, AudioBuffer>>;
    multisampleBanksRef: MutableRefObject<Map<string, MultisampleBank>>;
    choirLeftGainRef: MutableRefObject<GainNode | null>;
    choirRightGainRef: MutableRefObject<GainNode | null>;
    reverbNodesRef: MutableRefObject<Record<string, ConvolverNode>>;
    reverbTypeRef: MutableRefObject<'room' | 'plate' | 'hall'>;
    delayNodeRef: MutableRefObject<DelayNode | null>;
    harmonizerRef: MutableRefObject<Harmonizer | null>;
    nextSamplerNoteId: MutableRefObject<number>;
    activeSamplerNotes: MutableRefObject<Map<number, { source: AudioBufferSourceNode; envGain: GainNode }>>;
}

export function createSamplerPlayback(
    context: AudioContext,
    refs: SamplerPlaybackRefs,
    tempo: number,
) {
    const {
        masterSaturationRef,
        singingVoiceManagerRef,
        vocalAlignmentsRef,
        loadedSampleBuffersRef,
        multisampleBanksRef,
        choirLeftGainRef,
        choirRightGainRef,
        reverbNodesRef,
        reverbTypeRef,
        delayNodeRef,
        harmonizerRef,
        nextSamplerNoteId,
        activeSamplerNotes,
    } = refs;


    const triggerVoice = (ctx: SamplerVoiceContext, noteStr: string, voice: SingingVoice, pitchOffset: number, overrideTime?: number, overrideDuration?: number, destination?: AudioNode, isNewBank: boolean = true) => {
        const targetDuration = overrideDuration !== undefined ? overrideDuration : (ctx.durationSteps * ctx.stepTime);
        const originalDuration = ctx.buffer.duration;
        const triggerTime = overrideTime !== undefined ? overrideTime : ctx.actualTime;

        // Ensure voice connected to correct output
        voice.disconnectOutput();
        let finalDest = destination || masterSaturationRef.current!;

        // Apply Drive/Distortion if present
        const driveAmount = ctx.noteParams?.drive !== undefined ? ctx.noteParams.drive : ctx.params.drive;
        if (driveAmount !== undefined && driveAmount > 0) {
            const shaper = context.createWaveShaper();
            shaper.curve = makeDistortionCurve(driveAmount * 100);
            shaper.connect(finalDest);
            finalDest = shaper;
        }

        // Apply Per-Step Filter if present, or fallback to global filter settings
        if (ctx.noteParams?.filterCutoff !== undefined || ctx.noteParams?.filterResonance !== undefined || ctx.params.filterCutoff !== undefined || ctx.params.filterResonance !== undefined) {
            const filter = context.createBiquadFilter();
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

        voice.connectOutput(finalDest);

        // Setup Reverb Send
        const reverbSendAmount = ctx.noteParams?.reverbSend !== undefined ? ctx.noteParams.reverbSend : 0;
        const currentReverbType = (ctx.noteParams as any)?.reverbType || reverbTypeRef.current;
        const targetReverbNode = reverbNodesRef.current[currentReverbType] || reverbNodesRef.current['plate'];
        if (reverbSendAmount > 0 && targetReverbNode) {
            const reverbGain = context.createGain();
            reverbGain.gain.value = reverbSendAmount;
            reverbGain.connect(targetReverbNode);
            voice.connectOutput(reverbGain); // connectOutput appends to existing connections
        }

        // Setup Delay Send
        const delaySendAmount = ctx.noteParams?.delaySend !== undefined ? ctx.noteParams.delaySend : (ctx.params.delaySend || 0);
        if (delaySendAmount > 0 && delayNodeRef.current) {
            const delayGain = context.createGain();
            delayGain.gain.value = delaySendAmount;
            delayGain.connect(delayNodeRef.current);
            voice.connectOutput(delayGain);
        }
        // Apply Timbre Modulation (Formant Shift)
        const baseShift = ctx.params.formantShift || 0;
        let finalFormantShift = baseShift;
        if (ctx.noteParams?.formantShift !== undefined) {
            finalFormantShift = baseShift + ctx.noteParams.formantShift;
        } else if (ctx.noteParams?.timbre !== undefined) {
            const mod = (ctx.noteParams.timbre * 12) - 6; // +/- 6 semitones
            finalFormantShift = baseShift + mod;
        } else if (ctx.params.formantShift !== undefined) {
            finalFormantShift = ctx.params.formantShift;
        }

        const formantLinkRatio = ctx.noteParams?.formantPitchLink ?? ctx.params.formantPitchLink ?? 0.0;
        if (formantLinkRatio !== 0.0) {
            const rootNote = ctx.params.rootNote ?? 60;
            // Current MIDI pitch delta from the root note
            const coarse = (ctx.noteParams?.coarseTune ?? ctx.params.coarseTune ?? 0);
            const fine = (ctx.noteParams?.fineTune ?? ctx.params.fineTune ?? 0) / 100;
            const noteMidi = noteToMidi(noteStr) + ctx.pitchOffsetSemitones + coarse + fine;
            const pitchDeltaSemitones = noteMidi - rootNote;
            finalFormantShift += (pitchDeltaSemitones * formantLinkRatio);
        }

        voice.setFormantShift(finalFormantShift, triggerTime);


        // Apply Character Morphing
        const morphAmount = ctx.noteParams?.characterMorph !== undefined ? ctx.noteParams.characterMorph : (ctx.params.characterMorph ?? 0);
        const morphTarget = ctx.params.morphTarget || 'female';
        voice.setCharacterMorph(morphAmount, morphTarget as any, 0.05); // Use short ramp time

        // Sync other params
        if (ctx.noteParams?.vibratoDepth !== undefined) {
            voice.setVibratoDepth(ctx.noteParams.vibratoDepth, triggerTime);
        } else if (ctx.params.vibratoDepth !== undefined) {
            voice.setVibratoDepth(ctx.params.vibratoDepth, triggerTime);
        }

        if (ctx.noteParams?.gateDepth !== undefined) {
            voice.setGateDepth(ctx.noteParams.gateDepth, triggerTime);
        } else if (ctx.params.gateDepth !== undefined) {
            voice.setGateDepth(ctx.params.gateDepth, triggerTime);
        }

        if (ctx.noteParams?.gateRate !== undefined) {
            const rateHz = (tempo / 60) * (ctx.noteParams.gateRate / 4);
            voice.setGateRate(rateHz, triggerTime);
        } else if (ctx.params.gateRate !== undefined) {
            const rateHz = (tempo / 60) * (ctx.params.gateRate / 4);
            voice.setGateRate(rateHz, triggerTime);
        }
        if (ctx.params.tremoloDepth !== undefined) voice.setTremoloDepth(ctx.params.tremoloDepth, triggerTime);
        if (ctx.params.tremoloRate !== undefined) voice.setTremoloRate(ctx.params.tremoloRate, triggerTime);

        if (ctx.noteParams?.gateDepth !== undefined) {
            voice.setGateDepth(ctx.noteParams.gateDepth, triggerTime);
        } else if (ctx.params.gateDepth !== undefined) {
            voice.setGateDepth(ctx.params.gateDepth, triggerTime);
        }

        if (ctx.noteParams?.gateRate !== undefined) {
            voice.setGateRate(ctx.noteParams.gateRate, triggerTime);
        } else if (ctx.params.gateRate !== undefined) {
            voice.setGateRate(ctx.params.gateRate, triggerTime);
        }

        if (ctx.noteParams?.breathIntensity !== undefined) {
            voice.setBreathIntensity(ctx.noteParams.breathIntensity, triggerTime);
        } else if (ctx.params.breathIntensity !== undefined) {
            voice.setBreathIntensity(ctx.params.breathIntensity, triggerTime);
        }
        if (ctx.params.attack !== undefined) voice.setAttack(ctx.params.attack, triggerTime);
        if (ctx.params.decay !== undefined) voice.setDecay(ctx.params.decay, triggerTime);
        if (ctx.params.sustain !== undefined) voice.setSustain(ctx.params.sustain, triggerTime);
        if (ctx.params.release !== undefined) voice.setRelease(ctx.params.release, triggerTime);

        // Apply per-step or global freeze
        if (ctx.noteParams?.freeze !== undefined) {
            voice.setFreeze(ctx.noteParams.freeze, triggerTime);
        } else if (ctx.params.freeze !== undefined) {
            voice.setFreeze(ctx.params.freeze, triggerTime);
        }

        // Apply Envelope Follower depths (global only)
        if (ctx.params.freezeEnvDepth !== undefined) voice.setFreezeEnvDepth(ctx.params.freezeEnvDepth, triggerTime);
        if (ctx.params.grainEnvDepth !== undefined) voice.setGrainEnvDepth(ctx.params.grainEnvDepth, triggerTime);
        if (ctx.noteParams?.grainPitchQuantize !== undefined) {
            voice.setGrainPitchQuantize(ctx.noteParams.grainPitchQuantize, triggerTime);
        } else if (ctx.params.grainPitchQuantize !== undefined) {
            voice.setGrainPitchQuantize(ctx.params.grainPitchQuantize, triggerTime);
        }

        if (ctx.noteParams?.tranceGate !== undefined) {
            voice.setTranceGate(ctx.noteParams.tranceGate, triggerTime);
        }

        // Apply Formant LFO
        if (ctx.noteParams?.formantLfoRate !== undefined) {
            voice.setFormantLfoRate(ctx.noteParams.formantLfoRate, triggerTime);
        } else if (ctx.params.formantLfoRate !== undefined) {
            voice.setFormantLfoRate(ctx.params.formantLfoRate, triggerTime);
        }
        if (ctx.noteParams?.formantLfoDepth !== undefined) {
            voice.setFormantLfoDepth(ctx.noteParams.formantLfoDepth, triggerTime);
        } else if (ctx.params.formantLfoDepth !== undefined) {
            voice.setFormantLfoDepth(ctx.params.formantLfoDepth, triggerTime);
        }
        if (ctx.noteParams?.formantLfoShape !== undefined) {
            voice.setFormantLfoShape(ctx.noteParams.formantLfoShape);
        } else if (ctx.params.formantLfoShape !== undefined) {
            voice.setFormantLfoShape(ctx.params.formantLfoShape);
        } else {
            voice.setFormantLfoShape(undefined);
        }

        // Apply Character Morphing
        voice.setCharacterMorph(ctx.characterMorph, ctx.morphTarget as any, 0.05); // Use short ramp time

        // Sync other params
        if (ctx.pVibratoDepth !== undefined) voice.setVibratoDepth(ctx.pVibratoDepth, triggerTime);
        if (ctx.pTremoloDepth !== undefined) voice.setTremoloDepth(ctx.pTremoloDepth * 100, triggerTime); // setTremoloDepth expects percentage 0-100
        if (ctx.pTremoloRate !== undefined) voice.setTremoloRate(ctx.pTremoloRate, triggerTime);
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
        voice.setFormantEnvFollower(ctx.pFormantEnvFollower as number, triggerTime);
        voice.setFormantSidechainDepth(ctx.noteParams?.formantSidechainDepth ?? ctx.params.formantSidechainDepth ?? 0);

        // Load buffer only if the voice doesn't already have it
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
            voice.setPitchAttack(ctx.pPitchAttack, triggerTime);
        }
        if (voice.setPitchDecay) {
            voice.setPitchDecay(ctx.pPitchDecay, triggerTime);
        }
        if ((voice as any).setPitchAmount) {
            (voice as any).setPitchAmount(ctx.pPitchAmount, triggerTime);
        }

        voice.play(undefined, undefined, 1.0, ctx.noteParams?.reverse);

        const releaseTime = triggerTime + targetDuration;
        const delayMs = (releaseTime - context.currentTime) * 1000;
        if (delayMs > 0) {
            setTimeout(() => {
                voice.noteOff();
            }, delayMs);
        } else {
            voice.noteOff();
        }
    };

    const runVoices = (ctx: SamplerVoiceContext, noteStr: string, timeOffset: number, duration: number) => {
        const t = ctx.actualTime + timeOffset;

        const mainVoiceData = ctx.manager.acquireVoiceForBank(ctx.params.sampleName);
        ctx.manager.registerActiveVoice(mainVoiceData.index, noteStr, t);
        triggerVoice(ctx, noteStr, mainVoiceData.voice, 0, t, duration, undefined, mainVoiceData.isNewBank);

        const effectiveChoir = ctx.noteParams?.choir !== undefined ? ctx.noteParams.choir : (ctx.params.choir || 0);

        if (effectiveChoir > 0 && ctx.pitchOffsetSemitones === 0) {
            const detune = 0.15;
            const gain = effectiveChoir * 0.7;

            if (choirLeftGainRef.current) choirLeftGainRef.current.gain.setTargetAtTime(gain, t, 0.02);
            if (choirRightGainRef.current) choirRightGainRef.current.gain.setTargetAtTime(gain, t, 0.02);

            const leftVoiceData = ctx.manager.acquireVoiceForBank(ctx.params.sampleName);
            if (leftVoiceData.index !== mainVoiceData.index) {
                ctx.manager.registerActiveVoice(leftVoiceData.index, `${noteStr}_L`, t);
                triggerVoice(ctx, noteStr, leftVoiceData.voice, detune, t, duration, choirLeftGainRef.current!, leftVoiceData.isNewBank);
            }

            const rightVoiceData = ctx.manager.acquireVoiceForBank(ctx.params.sampleName);
            if (rightVoiceData.index !== mainVoiceData.index && rightVoiceData.index !== leftVoiceData.index) {
                ctx.manager.registerActiveVoice(rightVoiceData.index, `${noteStr}_R`, t);
                triggerVoice(ctx, noteStr, rightVoiceData.voice, -detune, t, duration, choirRightGainRef.current!, rightVoiceData.isNewBank);
            }
        } else if (ctx.pitchOffsetSemitones === 0) {
            if (choirLeftGainRef.current) choirLeftGainRef.current.gain.setTargetAtTime(0, t, 0.02);
            if (choirRightGainRef.current) choirRightGainRef.current.gain.setTargetAtTime(0, t, 0.02);
        }
    };

const playSamplerVoice = (
        params: SamplerBankParams,
        note: string | string[],
        time: number,
        durationSteps: number = 1,
        stepTime: number = 0.2,
        noteParams?: SamplerNoteParams,
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

    // Bolt Optimization: Hoist glitch math outside the polyphonic notes loop.
    // 1. Prevents redundant Math.random() calls and calculations per note in a chord.
    // 2. Ensures all notes in a polyphonic chord have the same stutter count and stay perfectly in sync.
    let numStutters = 0;
    let glitchStutterLenVoice = 0;
    const glitchStutterLenBuffer = 0.06;
    const totalDur = durationSteps * stepTime;

    if (shouldGlitch) {
        numStutters = Math.floor(Math.random() * 3) + 2;
        glitchStutterLenVoice = Math.min(0.06, totalDur / numStutters);
    }
    // --- GLITCH LOGIC END ---

    // Handle Polyphony (Chords)
    const notes = Array.isArray(note) ? note : [note];

    // Performance: Hoist expressive config resolution to avoid recalculating per note/retrigger.
    const expressiveConfig = resolveExpressiveness(params);

    // --- HOISTED PARAMETERS START ---
    // Vocoder Mix
    // ⚡ Bolt: Gate vocoder mix. When 0, downstream effects can bypass processing
    const _rawVocoderMix = noteParams?.vocoderMix ?? params.vocoderMix ?? 0;
    const vocoderMix = _rawVocoderMix > 0 ? _rawVocoderMix : undefined;
    const pVocoderFormantShift = noteParams?.vocoderFormantShift ?? params.formantShift ?? 0;
    const pVocoderPreservation = noteParams?.vocoderPreservation ?? 1.0;
    const pVocoderAttack = noteParams?.vocoderAttack ?? 0.01;
    const pVocoderRelease = noteParams?.vocoderRelease ?? 0.05;

    // Spectral Panning
    const spectralPanRate = noteParams?.spectralPanRate !== undefined ? noteParams.spectralPanRate : (params as any).spectralPanRate;
    // ⚡ Bolt: Gate spectral panning. When 0, downstream effects can bypass processing
    const _rawSpectralPanDepth = noteParams?.spectralPanDepth !== undefined ? noteParams.spectralPanDepth : (params as any).spectralPanDepth;
    const spectralPanDepth = _rawSpectralPanDepth !== undefined && _rawSpectralPanDepth > 0 ? _rawSpectralPanDepth : undefined;
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
    const pTremoloDepth = noteParams?.tremoloDepth !== undefined ? noteParams.tremoloDepth : params.tremoloDepth;
    const pTremoloRate = noteParams?.tremoloRate !== undefined ? noteParams.tremoloRate : params.tremoloRate;
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
    // --- HOISTED PARAMETERS END ---


    // If Singing/Stretch Mode
    if (params.mode === 'stretch' && singingVoiceManagerRef.current) {
        const manager = singingVoiceManagerRef.current;
        const alignment = vocalAlignmentsRef.current.get(params.sampleName);


            const ctx: SamplerVoiceContext = {
                buffer,
                params,
                noteParams,
                actualTime,
                durationSteps,
                stepTime,
                pitchOffsetSemitones,
                tuning,
                alignment,
                manager,
                characterMorph,
                morphTarget,
                pVibratoDepth,
                pTremoloDepth,
                pTremoloRate,
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
                pEnvAmount: pEnvAmount as number,
                pEnvAttack: pEnvAttack as number,
                pEnvDecay: pEnvDecay as number,
                pFormantEnvFollower: pFormantEnvFollower as number,
                pPitchAttack: pPitchAttack as number,
                pPitchDecay: pPitchDecay as number,
                pPitchAmount: pPitchAmount as number,
            };

        // For each note in the chord
        // ⚡ Bolt Optimization: Replacing forEach with for loop to prevent closure allocations on hot path
        for (let n = 0; n < notes.length; n++) {
            const noteStr = notes[n];
            if (shouldGlitch) {
                for (let i = 0; i < numStutters; i++) {
                    runVoices(ctx, noteStr, i * glitchStutterLenVoice, glitchStutterLenVoice);
                }
                const played = numStutters * glitchStutterLenVoice;
                if (totalDur > played) {
                    runVoices(ctx, noteStr, played, totalDur - played);
                }
            } else {
                for (let r = 0; r < retrigger; r++) {
                    const offset = r * (subDurationSteps * stepTime);
                    runVoices(ctx, noteStr, offset, subDurationSteps * stepTime);
                }
            }
        }
        return;
    }

    // Buffer playback mode (non-stretch)
    // ⚡ Bolt Optimization: Replacing forEach with for loop to prevent closure allocations on hot path
    for (let n = 0; n < notes.length; n++) {
        const noteStr = notes[n];
        const midi = noteToMidi(noteStr);

        if (shouldGlitch) {
            for (let i = 0; i < numStutters; i++) {
                playBufferSource(context, multisampleBank, masterSaturationRef.current, actualTime + i * glitchStutterLenBuffer, glitchStutterLenBuffer, midi, params, noteParams, buffer);
            }
            playBufferSource(context, multisampleBank, masterSaturationRef.current, actualTime + numStutters * glitchStutterLenBuffer, 0, midi, params, noteParams, buffer);
        } else {
            for (let r = 0; r < retrigger; r++) {
                const offset = r * (subDurationSteps * stepTime);
                playBufferSource(context, multisampleBank, masterSaturationRef.current, actualTime + offset, subDurationSteps * stepTime, midi, params, noteParams, buffer);
            }
        }
    }
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
    const noteStr = Array.isArray(note) ? note[0] : note;
    if (noteStr) {
        pulseExpressionLed('sampler', noteStr);
    }

    // Harmonize support - if harmonizer is active, generate multiple harmony voices
    const harmonizer = harmonizerRef.current;
    if (harmonizer?.getIsActive()) {
        const voices = harmonizer.generateVoices();

        // Play base voice (index 0) - the original note
        playSamplerVoice(params, note, time, durationSteps, stepTime, undefined, 0, tuning);

        // Play each harmony voice (skip index 0 which is base)
        // ⚡ Bolt Optimization: Replacing forEach with for loop to prevent closure allocations on hot path
        for (let i = 0; i < voices.length; i++) {
            const voice = voices[i];
            if (voice.index === 0) continue; // Skip base voice, already played above

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
        }
        return;
    }

    playSamplerVoice(params, note, time, durationSteps, stepTime, undefined, 0, tuning);
};

const noteOnSampler = (params: SamplerBankParams, note: string, time?: number, tuning?: any): number | null => {
    const now = time || context.currentTime;
    pulseExpressionLed('sampler', note);

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

    return { playSamplerVoice, playSampler, noteOnSampler, noteOffSampler };
}
