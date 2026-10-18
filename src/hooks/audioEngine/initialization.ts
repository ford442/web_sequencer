import type { MutableRefObject } from 'react';
import { Harmonizer } from '../../engines/Harmonizer';
import { ensureBufferMatchesContext } from '../../utils/resampleAudioBuffer';

export async function loadWavBuffer(context: AudioContext, url: string): Promise<AudioBuffer | null> {
    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const arrayBuffer = await response.arrayBuffer();
        const decoded = await context.decodeAudioData(arrayBuffer);
        return ensureBufferMatchesContext(decoded, context);
    } catch (error) {
        console.error(`Failed to load ${url}`, error);
        return null;
    }
}

export async function initializeSustainProcessor(
    context: AudioContext,
    sustainProcessorUrl: string,
    sustainNodeRef: MutableRefObject<AudioWorkletNode | null>,
    /** Plugs the worklet into the patch — its `samplerVoice` sustain node. */
    connectOutput: (node: AudioWorkletNode) => void,
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
        connectOutput(sustainNode);
        sustainNodeRef.current = sustainNode;
        console.log('SustainProcessor AudioWorklet initialized');
    } catch (error) {
        console.error('SustainProcessor AudioWorklet initialization failed:', error);
        // Clear the ref on failure - no fallback
        sustainNodeRef.current = null;
        throw new Error('AudioWorklet is required but failed to initialize. Browser may not support AudioWorklet.');
    }
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

export { createReverbImpulseResponse } from '../../audio/impulseResponses';

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
