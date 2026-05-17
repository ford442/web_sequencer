import type { MutableRefObject } from 'react';
import { Harmonizer } from '../../engines/Harmonizer';

import { makeDistortionCurve } from './distortion';

export function initializeMasterOutput(
    context: AudioContext,
    masterGainRef: MutableRefObject<GainNode | null>,
    masterPannerRef: MutableRefObject<StereoPannerNode | null>,
    masterSaturationRef: MutableRefObject<WaveShaperNode | null>,
    masterCompressorRef: MutableRefObject<DynamicsCompressorNode | null>,
    sidechainGainRef: MutableRefObject<BiquadFilterNode | null>,
    bassSidechainEQBusRef: MutableRefObject<BiquadFilterNode | null>,
): WaveShaperNode {
    const masterSaturation = context.createWaveShaper();
    masterSaturation.curve = makeDistortionCurve(0);
    masterSaturation.oversample = '4x';
    masterSaturationRef.current = masterSaturation;

    const masterCompressor = context.createDynamicsCompressor();
    masterCompressor.threshold.setValueAtTime(-15, context.currentTime);
    masterCompressor.knee.setValueAtTime(30, context.currentTime);
    masterCompressor.ratio.setValueAtTime(4, context.currentTime);
    masterCompressor.attack.setValueAtTime(0.03, context.currentTime);
    masterCompressor.release.setValueAtTime(0.25, context.currentTime);
    masterCompressorRef.current = masterCompressor;

    const masterGain = context.createGain();
    masterGain.gain.setValueAtTime(0.8, 0);
    masterGainRef.current = masterGain;

    // AI Auto-EQ Bus: ducks conflicting frequencies (e.g., 250Hz) when Bass plays
    const bassSidechainEQBus = context.createBiquadFilter();
    bassSidechainEQBus.type = 'peaking';
    bassSidechainEQBus.frequency.setValueAtTime(250, context.currentTime);
    bassSidechainEQBus.Q.setValueAtTime(1.0, context.currentTime);
    bassSidechainEQBus.gain.setValueAtTime(0.0, context.currentTime);
    bassSidechainEQBusRef.current = bassSidechainEQBus;

    // Use a low-shelf filter for sidechaining instead of a broadband gain duck.
    // This ducks only the low frequencies, leaving the highs intact (Spectral Sidechaining).
    const sidechainBus = context.createBiquadFilter();
    sidechainBus.type = 'lowshelf';
    sidechainBus.frequency.setValueAtTime(250, context.currentTime);
    sidechainBus.gain.setValueAtTime(0.0, context.currentTime); // 0 dB initially
    sidechainGainRef.current = sidechainBus;

    masterSaturation.connect(bassSidechainEQBus);
    bassSidechainEQBus.connect(sidechainBus);
    sidechainBus.connect(masterCompressor);
    masterCompressor.connect(masterGain);

    if (context.createStereoPanner) {
        const masterPanner = context.createStereoPanner();
        masterPanner.pan.setValueAtTime(0, 0);
        masterPannerRef.current = masterPanner;
        masterGain.connect(masterPanner);
        masterPanner.connect(context.destination);
    } else {
        masterGain.connect(context.destination);
    }

    return masterSaturation;
}

export function initializeHarmonyBus(
    context: AudioContext,
    masterSaturationRef: MutableRefObject<WaveShaperNode | null>,
    harmonyBusGainRef: MutableRefObject<GainNode | null>
): void {
    const harmonyBusGain = context.createGain();
    harmonyBusGain.gain.setValueAtTime(0.85, context.currentTime);

    const harmonyBusCompressor = context.createDynamicsCompressor();
    harmonyBusCompressor.threshold.setValueAtTime(-20, context.currentTime);
    harmonyBusCompressor.knee.setValueAtTime(30, context.currentTime);
    harmonyBusCompressor.ratio.setValueAtTime(2, context.currentTime);
    harmonyBusCompressor.attack.setValueAtTime(0.05, context.currentTime);
    harmonyBusCompressor.release.setValueAtTime(0.2, context.currentTime);

    const harmonyBusEqHigh = context.createBiquadFilter();
    harmonyBusEqHigh.type = 'highshelf';
    harmonyBusEqHigh.frequency.setValueAtTime(5000, context.currentTime);
    harmonyBusEqHigh.gain.setValueAtTime(2, context.currentTime);

    const harmonyBusEqLow = context.createBiquadFilter();
    harmonyBusEqLow.type = 'lowshelf';
    harmonyBusEqLow.frequency.setValueAtTime(250, context.currentTime);
    harmonyBusEqLow.gain.setValueAtTime(1.5, context.currentTime);

    harmonyBusGain.connect(harmonyBusCompressor);
    harmonyBusCompressor.connect(harmonyBusEqLow);
    harmonyBusEqLow.connect(harmonyBusEqHigh);
    if (masterSaturationRef.current) {
        harmonyBusEqHigh.connect(masterSaturationRef.current);
    } else {
        harmonyBusEqHigh.connect(context.destination);
    }

    harmonyBusGainRef.current = harmonyBusGain;
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
