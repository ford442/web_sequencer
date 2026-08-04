/**
 * Declarative AudioGraph model (Phase 1).
 * Describes node topology and roles without UI — compiled into Web Audio connections.
 */

export type GraphNodeId = string;

/** Semantic roles used by playback code to find entry/exit points. */
export type GraphNodeRole =
    | 'masterFxInput'
    | 'masterDryInput'
    | 'masterOutput'
    | 'masterLimiter'
    | 'trackBus'
    | 'trackAnalyser'
    | 'auxReturn'
    | 'choirBus'
    | 'internal';

export type GraphNodeFactory =
    | 'waveShaper'
    | 'biquadFilter'
    | 'dynamicsCompressor'
    | 'gain'
    | 'stereoPanner'
    | 'analyser'
    | 'convolver'
    | 'delay'
    | 'trackMonitor'
    | 'masterLimiter'
    | 'destination';

export interface BiquadFilterConfig {
    type: BiquadFilterType;
    frequency?: number;
    Q?: number;
    gain?: number;
}

export interface DynamicsCompressorConfig {
    threshold?: number;
    knee?: number;
    ratio?: number;
    attack?: number;
    release?: number;
}

export interface WaveShaperConfig {
    drive?: number;
    oversample?: OverSampleType;
}

export interface GainConfig {
    gain?: number;
}

export interface StereoPannerConfig {
    pan?: number;
}

export interface AnalyserConfig {
    fftSize?: number;
    smoothingTimeConstant?: number;
}

export interface ConvolverConfig {
    /** Reverb preset key — resolved at compile time via impulse factory. */
    reverbPreset?: 'room' | 'plate' | 'hall';
}

export interface DelayConfig {
    maxDelayTime?: number;
    delayTime?: number;
}

export interface TrackMonitorConfig {
    busGain?: number;
    analyserFftSize?: number;
    analyserSmoothing?: number;
}

export type GraphNodeConfig =
    | BiquadFilterConfig
    | DynamicsCompressorConfig
    | WaveShaperConfig
    | GainConfig
    | StereoPannerConfig
    | AnalyserConfig
    | ConvolverConfig
    | DelayConfig
    | TrackMonitorConfig
    | Record<string, never>;

export interface GraphNodeSpec {
    id: GraphNodeId;
    factory: GraphNodeFactory;
    role?: GraphNodeRole;
    config?: GraphNodeConfig;
}

export interface GraphEdgeSpec {
    from: GraphNodeId;
    to: GraphNodeId;
}

export interface AudioGraphConfig {
    id: string;
    name: string;
    nodes: GraphNodeSpec[];
    edges: GraphEdgeSpec[];
}

export interface GraphConnectionRecord {
    from: GraphNodeId;
    to: GraphNodeId;
    order: number;
}

export interface CompiledAudioGraph {
    configId: string;
    configName: string;
    nodes: ReadonlyMap<GraphNodeId, AudioNode>;
    /** Passive analyser taps keyed by graph node id (trackMonitor nodes). */
    analysers: ReadonlyMap<GraphNodeId, AnalyserNode>;
    roles: ReadonlyMap<GraphNodeRole, GraphNodeId | GraphNodeId[]>;
    connectionLog: readonly GraphConnectionRecord[];
    getNode<T extends AudioNode = AudioNode>(id: GraphNodeId): T;
    getRoleNode(role: GraphNodeRole): AudioNode | undefined;
    getRoleNodes(role: GraphNodeRole): AudioNode[];
}
