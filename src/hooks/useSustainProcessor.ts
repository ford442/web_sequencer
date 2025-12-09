import { useRef, useCallback, useState } from 'react';

/**
 * Hook for managing the SustainProcessor AudioWorklet
 * Provides track freezing, arpeggiator control, and sample sustain
 */

export interface ArpSettings {
    enabled: boolean;
    pattern: number[]; // Semitone offsets
    bpm: number;
}

export interface SustainNodeRef {
    node: AudioWorkletNode | null;
    isLoaded: boolean;
}

export const useSustainProcessor = (audioContext: AudioContext | null) => {
    const sustainNodeRef = useRef<AudioWorkletNode | null>(null);
    const [isWorkletReady, setIsWorkletReady] = useState(false);

    // Initialize the AudioWorklet
    const initWorklet = useCallback(async () => {
        if (!audioContext || isWorkletReady) return null;

        try {
            // Load the worklet module
            await audioContext.audioWorklet.addModule('/sustain-processor.js');

            // Create the node
            const sustainNode = new AudioWorkletNode(audioContext, 'sustain-processor', {
                numberOfInputs: 0,
                numberOfOutputs: 1,
                outputChannelCount: [2]
            });

            sustainNodeRef.current = sustainNode;
            setIsWorkletReady(true);

            console.log('SustainProcessor worklet initialized');
            return sustainNode;
        } catch (e) {
            console.error('Failed to init SustainProcessor:', e);
            return null;
        }
    }, [audioContext, isWorkletReady]);

    // Load a buffer into the processor
    const loadBuffer = useCallback((audioBuffer: AudioBuffer) => {
        if (!sustainNodeRef.current) return;

        // Get mono channel data
        const channelData = audioBuffer.getChannelData(0);

        // Send to worklet
        sustainNodeRef.current.port.postMessage({
            type: 'loadBuffer',
            data: { buffer: Array.from(channelData) }
        });

        console.log('Buffer loaded into SustainProcessor:', channelData.length, 'samples');
    }, []);

    // Set loop points
    const setLoopPoints = useCallback((start: number, end: number) => {
        if (!sustainNodeRef.current) return;

        sustainNodeRef.current.port.postMessage({
            type: 'setLoopPoints',
            data: { start, end }
        });
    }, []);

    // Set arpeggiator pattern
    const setArpPattern = useCallback((pattern: number[]) => {
        if (!sustainNodeRef.current) return;

        sustainNodeRef.current.port.postMessage({
            type: 'setArpPattern',
            data: { pattern }
        });
    }, []);

    // Trigger note on
    const noteOn = useCallback((pitch: number = 1.0) => {
        if (!sustainNodeRef.current) return;

        sustainNodeRef.current.port.postMessage({
            type: 'noteOn',
            data: { pitch }
        });
    }, []);

    // Trigger note off
    const noteOff = useCallback(() => {
        if (!sustainNodeRef.current) return;

        sustainNodeRef.current.port.postMessage({
            type: 'noteOff',
            data: {}
        });
    }, []);

    // Set grain size for stretch mode
    const setGrainSize = useCallback((size: number) => {
        if (!sustainNodeRef.current) return;

        sustainNodeRef.current.port.postMessage({
            type: 'setGrainSize',
            data: { size }
        });
    }, []);

    // Control parameters via AudioParam
    const setMode = useCallback((mode: 'loop' | 'stretch') => {
        if (!sustainNodeRef.current) return;

        const modeParam = sustainNodeRef.current.parameters.get('mode');
        if (modeParam) {
            modeParam.setValueAtTime(mode === 'loop' ? 0 : 1, 0);
        }
    }, []);

    const setBpm = useCallback((bpm: number) => {
        if (!sustainNodeRef.current) return;

        const bpmParam = sustainNodeRef.current.parameters.get('bpm');
        if (bpmParam) {
            bpmParam.setValueAtTime(bpm, 0);
        }
    }, []);

    const setArpEnabled = useCallback((enabled: boolean) => {
        if (!sustainNodeRef.current) return;

        const arpParam = sustainNodeRef.current.parameters.get('arp');
        if (arpParam) {
            arpParam.setValueAtTime(enabled ? 1 : 0, 0);
        }
    }, []);

    const setPitch = useCallback((pitch: number) => {
        if (!sustainNodeRef.current) return;

        const pitchParam = sustainNodeRef.current.parameters.get('pitch');
        if (pitchParam) {
            pitchParam.setValueAtTime(pitch, 0);
        }
    }, []);

    // Connect to destination
    const connect = useCallback((destination: AudioNode) => {
        if (!sustainNodeRef.current) return;
        sustainNodeRef.current.connect(destination);
    }, []);

    // Disconnect
    const disconnect = useCallback(() => {
        if (!sustainNodeRef.current) return;
        sustainNodeRef.current.disconnect();
    }, []);

    // Get the raw node for advanced usage
    const getNode = useCallback(() => sustainNodeRef.current, []);

    return {
        initWorklet,
        loadBuffer,
        setLoopPoints,
        setArpPattern,
        noteOn,
        noteOff,
        setGrainSize,
        setMode,
        setBpm,
        setArpEnabled,
        setPitch,
        connect,
        disconnect,
        getNode,
        isWorkletReady
    };
};

/**
 * Preset arpeggiator patterns
 */
export const ARP_PATTERNS = {
    major: [0, 4, 7, 12],
    minor: [0, 3, 7, 12],
    major7: [0, 4, 7, 11],
    minor7: [0, 3, 7, 10],
    dom7: [0, 4, 7, 10],
    sus4: [0, 5, 7, 12],
    octaves: [0, 12, 0, 12],
    fifths: [0, 7, 12, 7],
    chromaticUp: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    chromaticDown: [11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
} as const;

export type ArpPatternName = keyof typeof ARP_PATTERNS;
