import { makeDistortionCurve } from '../../hooks/audioEngine/distortion';
import { createReverbImpulseResponse } from '../impulseResponses';
import { WamSlotPorts } from '../wam/WamSlotPorts';
import { assertSafeGraphCycles } from './cycleCheck';
import {
    defaultEngineVoiceProvider,
    engineVoiceOf,
    isEngineVoiceFactory,
    type EngineVoiceProvider,
} from './engineVoices';
import { edgeKey, validateGraph } from './graphOps';
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
    GraphPortPair,
    StereoPannerConfig,
    TrackMonitorConfig,
    WaveShaperConfig,
} from './types';

export interface CompileGraphOptions {
    /** When false, skip masterPanner and connect masterGain → destination directly. */
    useStereoPanner?: boolean;
    createReverbImpulse?: (context: BaseAudioContext, preset: 'room' | 'plate' | 'hall') => AudioBuffer;
    /**
     * Supplies the master true-peak limiter / loudness-meter node.
     *
     * The stage is an AudioWorklet, so its module has to be loaded before the
     * graph is compiled — see `createMasterLoudnessStage`. Returning `null`
     * (the default) omits the node and bridges the chain straight to the
     * destination, so a browser that cannot register the worklet still plays.
     */
    createMasterLimiterNode?: (context: BaseAudioContext) => AudioNode | null;
    /**
     * Builds the socket a first-party engine (`open303Voice`, `drumkitVoice`,
     * …) attaches to. The default makes a plain port pair; the engine plugs its
     * worklet output in after it boots. Returning `null` omits the node and its
     * edges are bridged, like an absent limiter.
     */
    createEngineVoice?: EngineVoiceProvider;
    /**
     * Reject configs that fail `validateGraph` (cycles, dangling edges,
     * duplicate ids) instead of compiling them. On by default: a user-authored
     * patch must not be able to wire a runaway loop into the audio thread.
     * Disable only for tests that compile a deliberately partial subgraph.
     */
    validate?: boolean;
}

const DEFAULT_OPTIONS: Required<CompileGraphOptions> = {
    useStereoPanner: true,
    createMasterLimiterNode: () => null,
    createEngineVoice: defaultEngineVoiceProvider,
    validate: true,
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
    context: BaseAudioContext,
    spec: GraphNodeSpec,
    options: Required<CompileGraphOptions>,
    analysers: Map<GraphNodeId, AnalyserNode>,
    ports: Map<GraphNodeId, GraphPortPair>,
): AudioNode | null {
    const { factory, id, config } = spec;

    if (isEngineVoiceFactory(factory)) {
        const socket = options.createEngineVoice(context, {
            nodeId: id,
            factory,
            voice: engineVoiceOf(spec),
        });
        if (!socket) return null;
        ports.set(id, { input: socket.input, output: socket.output, engineSocket: socket });
        return socket.output;
    }

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
        case 'wamInstrumentSlot':
        case 'wamTrackInsert':
        case 'wamMasterInsert':
        case 'wamSendReturn': {
            const slot = new WamSlotPorts(context);
            ports.set(id, { input: slot.input, output: slot.output, wamSlot: slot });
            return slot.output;
        }
        default:
            throw new Error(`Unknown graph node factory: ${factory}`);
    }
}

/**
 * Remove edges through nodes that were not compiled, splicing predecessor to
 * successor so the chain stays connected — the optional master limiter, stereo
 * panners on a context without `createStereoPanner`, and engine nodes whose
 * provider declined. Edge order is preserved: the bridged edge takes the slot
 * of the incoming one, and keeps its send level.
 */
function bridgeAbsentNodes(
    edges: readonly GraphEdgeSpec[],
    absentIds: readonly GraphNodeId[],
): GraphEdgeSpec[] {
    let result = [...edges];
    for (const id of absentIds) {
        const successors = result.filter((edge) => edge.from === id).map((edge) => edge.to);
        const bridged: GraphEdgeSpec[] = [];
        for (const edge of result) {
            if (edge.from === id) continue;
            if (edge.to === id) {
                for (const to of successors) {
                    // A loop that only closed through the absent node is gone.
                    if (to === edge.from) continue;
                    bridged.push(
                        edge.gain === undefined
                            ? { from: edge.from, to }
                            : { from: edge.from, to, gain: edge.gain },
                    );
                }
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
 * Compile a declarative AudioGraphConfig into Web Audio nodes and connections.
 * Connection order follows the edges array — deterministic for testing.
 *
 * The context is a `BaseAudioContext`, not an `AudioContext`: the offline
 * render path (`compileOfflineGraph`) compiles the *same* patch into an
 * `OfflineAudioContext`, which is what keeps freeze / stems / preview on one
 * compiler instead of a second, quietly diverging one.
 */
export function compileAudioGraph(
    context: BaseAudioContext,
    config: AudioGraphConfig,
    options: CompileGraphOptions = {},
): CompiledAudioGraph {
    assertSafeGraphCycles(config);
    const resolved = { ...DEFAULT_OPTIONS, ...options };

    if (resolved.validate) {
        const validation = validateGraph(config);
        if (!validation.valid) {
            const detail = validation.issues.map((issue) => issue.message).join('; ');
            throw new Error(`AudioGraph compile failed: ${detail}`);
        }
    }

    const nodes = new Map<GraphNodeId, AudioNode>();
    const ports = new Map<GraphNodeId, GraphPortPair>();
    const sendGains = new Map<string, GainNode>();
    const analysers = new Map<GraphNodeId, AnalyserNode>();
    const roles = new Map<GraphNodeRole, GraphNodeId | GraphNodeId[]>();
    const connectionLog: GraphConnectionRecord[] = [];

    for (const spec of config.nodes) {
        const node = createNode(context, spec, resolved, analysers, ports);
        if (node) {
            nodes.set(spec.id, node);
            if (!ports.has(spec.id)) {
                ports.set(spec.id, { input: node, output: node });
            }
            if (spec.role) {
                registerRole(roles, spec.role, spec.id);
            }
        }
    }

    const present = new Set(nodes.keys());
    const absent = config.nodes
        .map((spec) => spec.id)
        .filter((id) => !present.has(id) && id !== 'destination');
    // The limiter's edges may outlive its spec in a hand-cut subgraph.
    if (!present.has('masterLimiter') && !absent.includes('masterLimiter')) absent.push('masterLimiter');
    const edges = bridgeAbsentNodes(config.edges, absent);

    for (const edge of edges) {
        const fromPort = ports.get(edge.from);
        const toPort = ports.get(edge.to);
        const fromNode = fromPort?.output ?? nodes.get(edge.from);
        const toNode =
            toPort?.input ??
            nodes.get(edge.to) ??
            (edge.to === 'destination' ? context.destination : undefined);
        if (!fromNode || !toNode) {
            throw new Error(
                `AudioGraph compile failed: missing node for edge ${edge.from} → ${edge.to}`,
            );
        }
        if (edge.gain !== undefined && edge.gain !== 1) {
            // Web Audio connections carry no level, so a send amount becomes an
            // implicit GainNode. It is kept in `sendGains` so the patch bay can
            // ride the fader without recompiling the graph.
            const send = context.createGain();
            send.gain.setValueAtTime(edge.gain, context.currentTime);
            fromNode.connect(send);
            send.connect(toNode);
            sendGains.set(edgeKey(edge.from, edge.to), send);
        } else {
            fromNode.connect(toNode);
        }
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
        ports,
        analysers,
        roles,
        connectionLog,
        sendGains,
        getNode<T extends AudioNode = AudioNode>(id: GraphNodeId): T {
            const node = nodes.get(id);
            if (!node) {
                throw new Error(`AudioGraph node not found: ${id}`);
            }
            return node as T;
        },
        getPort(id: GraphNodeId): GraphPortPair {
            const pair = ports.get(id);
            if (!pair) {
                throw new Error(`AudioGraph port not found: ${id}`);
            }
            return pair;
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
