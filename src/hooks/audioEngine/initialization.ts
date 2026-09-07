import type { MutableRefObject } from 'react';
import { Harmonizer } from '../../engines/Harmonizer';
import { compileAudioGraph } from '../../audio/graph/compileGraph';
import { CLASSIC_ELECTRIBE_GRAPH } from '../../audio/graph/defaultElectribeGraph';
import type { MasterChainRefs } from '../../audio/graph';
import { ensureBufferMatchesContext } from '../../utils/resampleAudioBuffer';

const MASTER_CHAIN_NODE_IDS = new Set([
    'masterSaturation',
    'bassSidechainEQ',
    'sidechainGain',
    'masterCompressor',
    'masterGain',
    'masterPanner',
    'destination',
    'masterAnalyser',
]);

function assignMasterChainRefs(
    graph: ReturnType<typeof compileAudioGraph>,
    refs: MasterChainRefs,
): WaveShaperNode {
    refs.masterSaturationRef.current = graph.getNode<WaveShaperNode>('masterSaturation');
    refs.bassSidechainEQBusRef.current = graph.getNode<BiquadFilterNode>('bassSidechainEQ');
    refs.sidechainGainRef.current = graph.getNode<BiquadFilterNode>('sidechainGain');
    refs.masterCompressorRef.current = graph.getNode<DynamicsCompressorNode>('masterCompressor');
    refs.masterGainRef.current = graph.getNode<GainNode>('masterGain');

    const panner = graph.nodes.get('masterPanner');
    refs.masterPannerRef.current = (panner as StereoPannerNode | undefined) ?? null;

    if (refs.analyserNodeRef) {
        refs.analyserNodeRef.current = graph.getNode<AnalyserNode>('masterAnalyser');
    }

    return refs.masterSaturationRef.current;
}

export function initializeMasterOutput(
    context: AudioContext,
    masterGainRef: MutableRefObject<GainNode | null>,
    masterPannerRef: MutableRefObject<StereoPannerNode | null>,
    masterSaturationRef: MutableRefObject<WaveShaperNode | null>,
    masterCompressorRef: MutableRefObject<DynamicsCompressorNode | null>,
    sidechainGainRef: MutableRefObject<BiquadFilterNode | null>,
    bassSidechainEQBusRef: MutableRefObject<BiquadFilterNode | null>,
    analyserNodeRef?: MutableRefObject<AnalyserNode | null>,
): WaveShaperNode {
    const masterConfig = {
        ...CLASSIC_ELECTRIBE_GRAPH,
        id: 'classic-electribe-master',
        name: 'Classic Electribe (master chain)',
        nodes: CLASSIC_ELECTRIBE_GRAPH.nodes.filter((n) => MASTER_CHAIN_NODE_IDS.has(n.id)),
        edges: CLASSIC_ELECTRIBE_GRAPH.edges.filter(
            (e) => MASTER_CHAIN_NODE_IDS.has(e.from) && MASTER_CHAIN_NODE_IDS.has(e.to),
        ),
    };

    const graph = compileAudioGraph(context, masterConfig);
    return assignMasterChainRefs(graph, {
        masterGainRef,
        masterPannerRef,
        masterSaturationRef,
        masterCompressorRef,
        sidechainGainRef,
        bassSidechainEQBusRef,
        analyserNodeRef,
    });
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
