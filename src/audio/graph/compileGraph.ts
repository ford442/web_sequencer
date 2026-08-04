import { makeDistortionCurve } from '../../hooks/audioEngine/distortion';
import { createReverbImpulseResponse } from '../impulseResponses';
import type {
    AnalyserConfig,
    AudioGraphConfig,
    BiquadFilterConfig,
    CompiledAudioGraph,
    ConvolverConfig,
    DelayConfig,
    DynamicsCompressorConfig,
    GainConfig,
    GraphConnectionRecord,
    GraphEdgeSpec,
    GraphNodeFactory,
    GraphNodeId,
    GraphNodeRole,
    GraphNodeSpec,
    StereoPannerConfig,
    TrackMonitorConfig,
    WaveShaperConfig,
} from './types';

export interface CompileGraphOptions {
    /** When false, skip masterPanner and connect masterGain → destination directly. */
    useStereoPanner?: boolean;
    createReverbImpulse?: (context: AudioContext, preset: 'room' | 'plate' | 'hall') => AudioBuffer;
    /**
     * Supplies the master true-peak limiter / loudness-meter node.
     *
     * The stage is an AudioWorklet, so its module has to be loaded before the
     * graph is compiled — see `createMasterLoudnessStage`. Returning `null`
     * (the default) omits the node and bridges the chain straight to the
     * destination, so a browser that cannot register the worklet still plays.
     */
    createMasterLimiterNode?: (context: AudioContext) => AudioNode | null;
}

const DEFAULT_OPTIONS: Required<CompileGraphOptions> = {
    useStereoPanner: true,
    createMasterLimiterNode: () => null,
    createReverbImpulse: (context, preset) => {
        switch (preset) {
            case 'room':
                return createReverbImpulseResponse(context, 0.5, 1.0);
            case 'plate':
                return createReverbImpulseResponse(context, 1.5, 2.0);
            case 'hall':
                return createReverbImpulseResponse(context, 3.5, 3.0);
        }
    },
};

function asConfig<T>(config: GraphNodeSpec['config']): T {
    return (config ?? {}) as T;
}

function createNode(
    context: AudioContext,
    spec: GraphNodeSpec,
    options: Required<CompileGraphOptions>,
    analysers: Map<GraphNodeId, AnalyserNode>,
): AudioNode | null {
    const { factory, id, config } = spec;

    switch (factory as GraphNodeFactory) {
        case 'waveShaper': {
            const cfg = asConfig<WaveShaperConfig>(config);
            const node = context.createWaveShaper();
            node.curve = makeDistortionCurve(cfg.drive ?? 0);
            node.oversample = cfg.oversample ?? '4x';
            return node;
        }
        case 'biquadFilter': {
            const cfg = asConfig<BiquadFilterConfig>(config);
            const node = context.createBiquadFilter();
            node.type = cfg.type;
            const t = context.currentTime;
            if (cfg.frequency !== undefined) {
                node.frequency.setValueAtTime(cfg.frequency, t);
            }
            if (cfg.Q !== undefined) {
                node.Q.setValueAtTime(cfg.Q, t);
            }
            if (cfg.gain !== undefined) {
                node.gain.setValueAtTime(cfg.gain, t);
            }
            return node;
        }
        case 'dynamicsCompressor': {
            const cfg = asConfig<DynamicsCompressorConfig>(config);
            const node = context.createDynamicsCompressor();
            const t = context.currentTime;
            if (cfg.threshold !== undefined) node.threshold.setValueAtTime(cfg.threshold, t);
            if (cfg.knee !== undefined) node.knee.setValueAtTime(cfg.knee, t);
            if (cfg.ratio !== undefined) node.ratio.setValueAtTime(cfg.ratio, t);
            if (cfg.attack !== undefined) node.attack.setValueAtTime(cfg.attack, t);
            if (cfg.release !== undefined) node.release.setValueAtTime(cfg.release, t);
            return node;
        }
        case 'gain': {
            const cfg = asConfig<GainConfig>(config);
            const node = context.createGain();
            node.gain.setValueAtTime(cfg.gain ?? 1, 0);
            return node;
        }
        case 'stereoPanner': {
            const cfg = asConfig<StereoPannerConfig>(config);
            if (!options.useStereoPanner || !context.createStereoPanner) {
                return null;
            }
            const node = context.createStereoPanner();
            node.pan.setValueAtTime(cfg.pan ?? 0, 0);
            return node;
        }
        case 'analyser': {
            const cfg = asConfig<AnalyserConfig>(config);
            const node = context.createAnalyser();
            if (cfg.fftSize !== undefined) node.fftSize = cfg.fftSize;
            if (cfg.smoothingTimeConstant !== undefined) {
                node.smoothingTimeConstant = cfg.smoothingTimeConstant;
            }
            return node;
        }
        case 'convolver': {
            const cfg = asConfig<ConvolverConfig>(config);
            const node = context.createConvolver();
            if (cfg.reverbPreset) {
                node.buffer = options.createReverbImpulse(context, cfg.reverbPreset);
            }
            return node;
        }
        case 'delay': {
            const cfg = asConfig<DelayConfig>(config);
            const node = context.createDelay(cfg.maxDelayTime ?? 2.0);
            node.delayTime.value = cfg.delayTime ?? 0.375;
            return node;
        }
        case 'trackMonitor': {
            const cfg = asConfig<TrackMonitorConfig>(config);
            const bus = context.createGain();
            bus.gain.value = cfg.busGain ?? 1;
            const analyser = context.createAnalyser();
            analyser.fftSize = cfg.analyserFftSize ?? 256;
            analyser.smoothingTimeConstant = cfg.analyserSmoothing ?? 0.55;
            bus.connect(analyser);
            analysers.set(id, analyser);
            return bus;
        }
        case 'masterLimiter':
            return options.createMasterLimiterNode(context);
        case 'destination':
            return context.destination;
        default:
            throw new Error(`Unknown graph node factory: ${factory}`);
    }
}

/**
 * Remove edges through nodes that were not compiled, splicing predecessor to
 * successor so the chain stays connected (used for the optional master limiter).
 * Edge order is preserved: the bridged edge takes the slot of the incoming one.
 */
function bridgeAbsentNodes(
    edges: readonly GraphEdgeSpec[],
    present: ReadonlySet<GraphNodeId>,
    optionalIds: readonly GraphNodeId[],
): GraphEdgeSpec[] {
    let result = [...edges];
    for (const id of optionalIds) {
        if (present.has(id)) continue;
        const successors = result.filter((edge) => edge.from === id).map((edge) => edge.to);
        const bridged: GraphEdgeSpec[] = [];
        for (const edge of result) {
            if (edge.from === id) continue;
            if (edge.to === id) {
                for (const to of successors) bridged.push({ from: edge.from, to });
                continue;
            }
            bridged.push(edge);
        }
        result = bridged;
    }
    return result;
}

function registerRole(
    roles: Map<GraphNodeRole, GraphNodeId | GraphNodeId[]>,
    role: GraphNodeRole,
    nodeId: GraphNodeId,
): void {
    const existing = roles.get(role);
    if (existing === undefined) {
        roles.set(role, nodeId);
        return;
    }
    if (Array.isArray(existing)) {
        existing.push(nodeId);
        return;
    }
    roles.set(role, [existing, nodeId]);
}

/**
 * Compile a declarative AudioGraphConfig into live Web Audio nodes and connections.
 * Connection order follows the edges array — deterministic for testing.
 */
export function compileAudioGraph(
    context: AudioContext,
    config: AudioGraphConfig,
    options: CompileGraphOptions = {},
): CompiledAudioGraph {
    const resolved = { ...DEFAULT_OPTIONS, ...options };
    const nodes = new Map<GraphNodeId, AudioNode>();
    const analysers = new Map<GraphNodeId, AnalyserNode>();
    const roles = new Map<GraphNodeRole, GraphNodeId | GraphNodeId[]>();
    const connectionLog: GraphConnectionRecord[] = [];

    for (const spec of config.nodes) {
        const node = createNode(context, spec, resolved, analysers);
        if (node) {
            nodes.set(spec.id, node);
            if (spec.role) {
                registerRole(roles, spec.role, spec.id);
            }
        }
    }

    // When stereo panner node was not created, reroute masterGain → destination
    const hasStereoPanner = nodes.has('masterPanner');
    const optionalEdges = bridgeAbsentNodes(config.edges, new Set(nodes.keys()), ['masterLimiter']);

    const edges = optionalEdges.filter((edge) => {
        if (hasStereoPanner) return true;
        if (edge.from === 'masterGain' && edge.to === 'masterPanner') return false;
        if (edge.from === 'masterPanner') return false;
        return true;
    });

    if (!hasStereoPanner) {
        const masterGain = nodes.get('masterGain');
        const limiter = nodes.get('masterLimiter');
        if (masterGain) {
            masterGain.connect(limiter ?? context.destination);
            connectionLog.push({
                from: 'masterGain',
                to: limiter ? 'masterLimiter' : 'destination',
                order: connectionLog.length,
            });
        }
    }

    for (const edge of edges) {
        const fromNode = nodes.get(edge.from);
        const toNode = nodes.get(edge.to) ?? (edge.to === 'destination' ? context.destination : undefined);
        if (!fromNode || !toNode) {
            if (!hasStereoPanner && (edge.to === 'masterPanner' || edge.from === 'masterPanner')) {
                continue;
            }
            throw new Error(
                `AudioGraph compile failed: missing node for edge ${edge.from} → ${edge.to}`,
            );
        }
        fromNode.connect(toNode);
        connectionLog.push({
            from: edge.from,
            to: edge.to,
            order: connectionLog.length,
        });
    }

    return {
        configId: config.id,
        configName: config.name,
        nodes,
        analysers,
        roles,
        connectionLog,
        getNode<T extends AudioNode = AudioNode>(id: GraphNodeId): T {
            const node = nodes.get(id);
            if (!node) {
                throw new Error(`AudioGraph node not found: ${id}`);
            }
            return node as T;
        },
        getRoleNode(role: GraphNodeRole): AudioNode | undefined {
            const entry = roles.get(role);
            if (!entry) return undefined;
            const id = Array.isArray(entry) ? entry[0] : entry;
            return nodes.get(id);
        },
        getRoleNodes(role: GraphNodeRole): AudioNode[] {
            const entry = roles.get(role);
            if (!entry) return [];
            const ids = Array.isArray(entry) ? entry : [entry];
            return ids.map((nodeId) => nodes.get(nodeId)).filter((n): n is AudioNode => n !== undefined);
        },
    };
}

/** Extract in-series master chain connections from a compiled graph log. */
export function extractMasterChainConnections(
    log: readonly GraphConnectionRecord[],
): Array<{ from: string; to: string }> {
    const masterIds = new Set([
        'masterLimiter',
        'masterSaturation',
        'bassSidechainEQ',
        'sidechainGain',
        'masterCompressor',
        'masterGain',
        'masterPanner',
        'destination',
    ]);
    return log
        .filter((c) => masterIds.has(c.from) && masterIds.has(c.to))
        .map(({ from, to }) => ({ from, to }));
}
