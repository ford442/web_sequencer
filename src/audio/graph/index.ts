import type { MutableRefObject } from 'react';
import type { TrackAnalysers } from '../../types';
import { compileAudioGraph } from './compileGraph';
import { CLASSIC_ELECTRIBE_GRAPH } from './defaultElectribeGraph';
import { PatchController } from './patchController';
import type { CompiledAudioGraph } from './types';

export interface MasterChainRefs {
    masterGainRef: MutableRefObject<GainNode | null>;
    masterPannerRef: MutableRefObject<StereoPannerNode | null>;
    masterSaturationRef: MutableRefObject<WaveShaperNode | null>;
    masterCompressorRef: MutableRefObject<DynamicsCompressorNode | null>;
    sidechainGainRef: MutableRefObject<BiquadFilterNode | null>;
    bassSidechainEQBusRef: MutableRefObject<BiquadFilterNode | null>;
    analyserNodeRef?: MutableRefObject<AnalyserNode | null>;
}

export interface TrackBusRefs {
    synthABusRef: MutableRefObject<GainNode | null>;
    synthBBusRef: MutableRefObject<GainNode | null>;
    samplerBusRef: MutableRefObject<GainNode | null>;
    trackAnalysersRef: MutableRefObject<TrackAnalysers>;
}

export interface AuxSendRefs {
    reverbNodesRef: MutableRefObject<Record<string, ConvolverNode>>;
    reverbNodeRef: MutableRefObject<ConvolverNode | null>;
    delayNodeRef: MutableRefObject<DelayNode | null>;
    delayFeedbackRef: MutableRefObject<GainNode | null>;
}

export interface ChoirBusRefs {
    choirLeftGainRef: MutableRefObject<GainNode | null>;
    choirRightGainRef: MutableRefObject<GainNode | null>;
    choirLeftPannerRef: MutableRefObject<StereoPannerNode | null>;
    choirRightPannerRef: MutableRefObject<StereoPannerNode | null>;
}

export interface ElectribeGraphRefs extends MasterChainRefs, TrackBusRefs, AuxSendRefs, ChoirBusRefs {}

function assignMasterChainRefs(graph: CompiledAudioGraph, refs: MasterChainRefs): WaveShaperNode {
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

function assignTrackBusRefs(graph: CompiledAudioGraph, refs: TrackBusRefs): void {
    refs.synthABusRef.current = graph.getNode<GainNode>('synthABus');
    refs.synthBBusRef.current = graph.getNode<GainNode>('synthBBus');
    refs.samplerBusRef.current = graph.getNode<GainNode>('samplerBus');

    refs.trackAnalysersRef.current.synthA = graph.analysers.get('synthABus');
    refs.trackAnalysersRef.current.synthB = graph.analysers.get('synthBBus');
    refs.trackAnalysersRef.current.sampler = graph.analysers.get('samplerBus');
}

function assignAuxSendRefs(graph: CompiledAudioGraph, refs: AuxSendRefs): void {
    const room = graph.getNode<ConvolverNode>('reverbRoom');
    const plate = graph.getNode<ConvolverNode>('reverbPlate');
    const hall = graph.getNode<ConvolverNode>('reverbHall');
    refs.reverbNodesRef.current = { room, plate, hall };
    refs.reverbNodeRef.current = plate;
    refs.delayNodeRef.current = graph.getNode<DelayNode>('delay');
    refs.delayFeedbackRef.current = graph.getNode<GainNode>('delayFeedback');
}

function assignChoirBusRefs(graph: CompiledAudioGraph, refs: ChoirBusRefs): void {
    refs.choirLeftGainRef.current = graph.getNode<GainNode>('choirLeftGain');
    refs.choirRightGainRef.current = graph.getNode<GainNode>('choirRightGain');
    refs.choirLeftPannerRef.current = graph.getNode<StereoPannerNode>('choirLeftPanner');
    refs.choirRightPannerRef.current = graph.getNode<StereoPannerNode>('choirRightPanner');
}

export interface BuildElectribeGraphResult {
    graph: CompiledAudioGraph;
    masterBusInput: WaveShaperNode;
}

export interface BuildElectribeGraphOptions {
    /**
     * Patch to compile instead of the stock Classic Electribe graph — the user's
     * saved patch from the song payload. The controller is attached to the
     * compiled result so live edits patch the running graph.
     */
    patchController?: PatchController | null;
    /**
     * Master true-peak limiter / loudness-meter node, already constructed via
     * `createMasterLoudnessStage`. Omit it and the chain runs panner →
     * destination exactly as before.
     */
    masterLimiterNode?: AudioNode | null;
}

/**
 * Build the default Classic Electribe routing graph and populate engine refs.
 */
export function buildClassicElectribeGraph(
    context: AudioContext,
    refs: ElectribeGraphRefs,
    options: BuildElectribeGraphOptions = {},
): BuildElectribeGraphResult {
    const limiterNode = options.masterLimiterNode ?? null;
    const compileOptions = { createMasterLimiterNode: () => limiterNode };
    const controller = options.patchController ?? null;
    const graph = controller
        ? controller.compile(context, compileOptions)
        : compileAudioGraph(context, CLASSIC_ELECTRIBE_GRAPH, compileOptions);
    const masterBusInput = assignMasterChainRefs(graph, refs);
    assignTrackBusRefs(graph, refs);
    assignAuxSendRefs(graph, refs);
    assignChoirBusRefs(graph, refs);
    return { graph, masterBusInput };
}

export {
    CLASSIC_ELECTRIBE_GRAPH,
    MASTER_CHAIN_ORDER,
    MASTER_CHAIN_ORDER_WITH_LIMITER,
    MASTER_CHAIN_CONNECTIONS,
} from './defaultElectribeGraph';
export { compileAudioGraph, extractMasterChainConnections } from './compileGraph';
export type { CompileGraphOptions } from './compileGraph';
export {
    addConnection,
    addNode,
    edgeKey,
    findCycle,
    findEdge,
    removeConnection,
    removeNode,
    setConnectionGain,
    setNodePosition,
    validateGraph,
} from './graphOps';
export type {
    GraphEditResult,
    GraphValidationCode,
    GraphValidationIssue,
    GraphValidationResult,
} from './graphOps';
export {
    GRAPH_SCHEMA_VERSION,
    deserializeAudioGraph,
    graphsEqual,
    parseAudioGraphConfig,
    serializeAudioGraph,
} from './graphSerialization';
export type { DeserializedGraph, SerializedAudioGraph } from './graphSerialization';
export { PatchController } from './patchController';
export type { PatchEditOutcome, PatchListener } from './patchController';
export { GRAPH_PRESETS, DEFAULT_PRESET_ID, buildPreset } from './presets';
export {
    layoutGraph,
    cablePath,
    inputPort,
    outputPort,
    NODE_WIDTH,
    NODE_HEIGHT,
} from './layout';
export type { GraphLayout, NodeLayout } from './layout';
export type { GraphPreset } from './presets';
export { restorePatchFromSong } from './patchSession';
export type { PatchRestoreResult } from './patchSession';
export {
    setActivePatchController,
    getActivePatchController,
    subscribeActivePatchController,
} from './patchRegistry';
export type {
    AudioGraphConfig,
    GraphEdgeSpec,
    GraphNodeSpec,
    CompiledAudioGraph,
    GraphConnectionRecord,
    GraphNodeId,
    GraphNodeRole,
    GraphPortPair,
} from './types';
export { assertSafeGraphCycles, GraphCycleError } from './cycleCheck';
