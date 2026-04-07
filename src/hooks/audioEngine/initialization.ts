import type { MutableRefObject } from 'react';
import { Harmonizer } from '../../engines/Harmonizer';

import { makeDistortionCurve } from './distortion';

export function initializeMasterOutput(
    context: AudioContext,
    masterGainRef: MutableRefObject<GainNode | null>,
    masterPannerRef: MutableRefObject<StereoPannerNode | null>,
    masterSaturationRef: MutableRefObject<WaveShaperNode | null>,
): GainNode {
    const masterGain = context.createGain();
    masterGain.gain.setValueAtTime(0.8, 0);
    masterGainRef.current = masterGain;

    const masterSaturation = context.createWaveShaper();
    masterSaturation.curve = makeDistortionCurve(0);
    masterSaturation.oversample = '4x';
    masterSaturationRef.current = masterSaturation;

    masterGain.connect(masterSaturation);

    if (context.createStereoPanner) {
        const masterPanner = context.createStereoPanner();
        masterPanner.pan.setValueAtTime(0, 0);
        masterPannerRef.current = masterPanner;
        masterSaturation.connect(masterPanner);
        masterPanner.connect(context.destination);
    } else {
        masterSaturation.connect(context.destination);
    }

    return masterGain;
}

export async function loadWavBuffer(context: AudioContext, url: string): Promise<AudioBuffer | null> {
    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const arrayBuffer = await response.arrayBuffer();
        return await context.decodeAudioData(arrayBuffer);
    } catch (error) {
        console.error(`Failed to load ${url}`, error);
        return null;
    }
}

export async function initializeSustainProcessor(
    context: AudioContext,
    sustainProcessorUrl: string,
    sustainNodeRef: MutableRefObject<AudioWorkletNode | null>,
    masterGainRef: MutableRefObject<GainNode | null>,
): Promise<void> {
    // AudioWorklet is now the only supported path
    // ScriptProcessorNode fallback removed as it's deprecated and runs on main thread
    try {
        await context.audioWorklet.addModule(sustainProcessorUrl);
        const sustainNode = new AudioWorkletNode(context, 'sustain-processor', {
            numberOfInputs: 0,
            numberOfOutputs: 1,
            outputChannelCount: [2],
        });
        sustainNode.connect(masterGainRef.current!);
        sustainNodeRef.current = sustainNode;
        console.log('SustainProcessor AudioWorklet initialized');
    } catch (error) {
        console.error('SustainProcessor AudioWorklet initialization failed:', error);
        // Clear the ref on failure - no fallback
        sustainNodeRef.current = null;
        throw new Error('AudioWorklet is required but failed to initialize. Browser may not support AudioWorklet.');
    }
}

export function initializeChoirBuses(
    context: AudioContext,
    masterGainRef: MutableRefObject<GainNode | null>,
    choirLeftGainRef: MutableRefObject<GainNode | null>,
    choirRightGainRef: MutableRefObject<GainNode | null>,
    choirLeftPannerRef: MutableRefObject<StereoPannerNode | null>,
    choirRightPannerRef: MutableRefObject<StereoPannerNode | null>,
): void {
    const gainLeft = context.createGain();
    gainLeft.gain.value = 0;
    choirLeftGainRef.current = gainLeft;
    const pannerLeft = context.createStereoPanner();
    pannerLeft.pan.value = -0.6;
    choirLeftPannerRef.current = pannerLeft;
    gainLeft.connect(pannerLeft);
    pannerLeft.connect(masterGainRef.current!);

    const gainRight = context.createGain();
    gainRight.gain.value = 0;
    choirRightGainRef.current = gainRight;
    const pannerRight = context.createStereoPanner();
    pannerRight.pan.value = 0.6;
    choirRightPannerRef.current = pannerRight;
    gainRight.connect(pannerRight);
    pannerRight.connect(masterGainRef.current!);
}

export function createNoiseBuffer(context: AudioContext): AudioBuffer {
    const bufferSize = context.sampleRate * 2;
    const buffer = context.createBuffer(1, bufferSize, context.sampleRate);
    const output = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
        output[i] = Math.random() * 2 - 1;
    }
    return buffer;
}

export function createReverbImpulseResponse(context: AudioContext, duration: number = 2.0, decay: number = 2.0): AudioBuffer {
    const sampleRate = context.sampleRate;
    const length = sampleRate * duration;
    const impulse = context.createBuffer(2, length, sampleRate);
    const left = impulse.getChannelData(0);
    const right = impulse.getChannelData(1);

    for (let i = 0; i < length; i++) {
        const n = i / sampleRate;
        const e = Math.pow(1 - n / duration, decay);
        left[i] = (Math.random() * 2 - 1) * e;
        right[i] = (Math.random() * 2 - 1) * e;
    }

    return impulse;
}

export function initializeHarmonizer(harmonizerRef: MutableRefObject<Harmonizer | null>): void {
    try {
        harmonizerRef.current = new Harmonizer({
            voiceCount: 2,
            harmonyType: 'third',
            detuneSpread: 15,
            formantSpread: 3,
        });
        console.log('[useAudioEngine] Harmonizer initialized');
    } catch (error) {
        console.warn('Harmonizer failed to init:', error);
    }
}
