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
    | 'internal'
    | 'instrumentSource'
    | 'trackInsert'
    | 'masterInsert'
    | 'auxSend';

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
    | 'destination'
    | 'wamInstrumentSlot'
    | 'wamTrackInsert'
    | 'wamMasterInsert'
    | 'wamSendReturn';

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
    /** Human-readable name for the patch bay. Falls back to the id. */
    label?: string;
    /**
     * Fixed nodes belong to the preset's skeleton — the patch bay refuses to
     * delete them, because playback code resolves them by role or by id.
     * Nodes the user adds are omitted (undefined = user-owned).
     */
    fixed?: boolean;
    /** Editor placement, persisted so a patch looks the same when reopened. */
    position?: { x: number; y: number };
}

export interface GraphEdgeSpec {
    from: GraphNodeId;
    to: GraphNodeId;
    /**
     * Send amount, linear 0…1. When present (and not exactly 1) the compiler
     * inserts an implicit GainNode between the two nodes — Web Audio
     * connections themselves carry no level.
     */
    gain?: number;
    /**
     * Marks an edge that intentionally closes a loop (the global delay's
     * feedback path). Cycle detection walks the graph with these edges removed;
     * without the flag the classic topology would be rejected as cyclic.
     */
    feedback?: boolean;
}

export interface AudioGraphConfig {
    id: string;
    name: string;
    nodes: GraphNodeSpec[];
    edges: GraphEdgeSpec[];
    /**
     * Preset this graph was derived from, carried through user edits so the UI
     * can show "Classic Electribe (modified)" and offer a revert.
     */
    presetId?: string;
}

export interface GraphConnectionRecord {
    from: GraphNodeId;
    to: GraphNodeId;
    order: number;
}

/** Dual-port pair so inserts have a distinct input and output. */
export interface GraphPortPair {
    input: AudioNode;
    output: AudioNode;
    wamSlot?: import('../wam/WamSlotPorts').WamSlotPorts;
}

export interface CompiledAudioGraph {
    configId: string;
    configName: string;
    nodes: ReadonlyMap<GraphNodeId, AudioNode>;
    /** Incoming/outgoing ports. Simple nodes have input === output. */
    ports: ReadonlyMap<GraphNodeId, GraphPortPair>;
    /** Passive analyser taps keyed by graph node id (trackMonitor nodes). */
    analysers: ReadonlyMap<GraphNodeId, AnalyserNode>;
    roles: ReadonlyMap<GraphNodeRole, GraphNodeId | GraphNodeId[]>;
    connectionLog: readonly GraphConnectionRecord[];
    /**
     * Implicit send-level GainNodes, keyed `${from}→${to}`. The patch bay
     * adjusts send amounts through these without recompiling the graph.
     */
    sendGains: ReadonlyMap<string, GainNode>;
    getNode<T extends AudioNode = AudioNode>(id: GraphNodeId): T;
    getPort(id: GraphNodeId): GraphPortPair;
    getRoleNode(role: GraphNodeRole): AudioNode | undefined;
    getRoleNodes(role: GraphNodeRole): AudioNode[];
}
