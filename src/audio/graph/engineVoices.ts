/**
 * First-party engines as graph nodes (patch bay Phase C).
 *
 * Open303, Prophecy, the analog drum kit, the sampler worklets and the choir
 * sum used to enter the running graph through hard-wired lifecycle code, so a
 * patch could not see them and a WAM2 insert had nowhere to sit. Each now has a
 * factory, and each compiles to an {@link EngineVoiceSocket}: a dual-port pair
 * (like a WAM2 slot) that the engine's output attaches to once it has booted.
 *
 * Why a socket rather than the engine node itself: the graph is compiled before
 * any engine worklet is loaded (and an offline render compiles it with no live
 * engine at all). The socket exists from compile time, so cables, inserts and
 * sends are wired against it immediately; the engine plugs in when it is ready,
 * and an engine that fails to boot leaves an honest silent socket rather than a
 * dangling edge.
 *
 * No new WASM world and no new heap: the engines behind these sockets are the
 * same `open303_*` / `prophecy_*` / `macro_*` / `drumkit_*` handles on the one shared
 * hyphon_native instance. A socket is two `GainNode`s on the main graph.
 */

import type { CompiledAudioGraph, EngineVoiceConfig, GraphNodeFactory, GraphNodeId, GraphNodeSpec } from './types';

export type EngineVoiceFactory =
    | 'open303Voice'
    | 'prophecyVoice'
    | 'macroVoice'
    | 'drumkitVoice'
    | 'samplerVoice'
    | 'harmonizerBus';

export const ENGINE_VOICE_FACTORIES: ReadonlySet<GraphNodeFactory> = new Set<EngineVoiceFactory>([
    'open303Voice',
    'prophecyVoice',
    'macroVoice',
    'drumkitVoice',
    'samplerVoice',
    'harmonizerBus',
]);

export function isEngineVoiceFactory(factory: string): factory is EngineVoiceFactory {
    return ENGINE_VOICE_FACTORIES.has(factory as GraphNodeFactory);
}

/**
 * Anything that can feed a socket: an `AudioNode`, or an engine wrapper such as
 * `Open303Oscillator` that owns its worklet node and forwards `connect`.
 */
export interface EngineOutput {
    connect(destination: AudioNode): unknown;
}

/**
 * Port pair for one engine voice.
 *
 * `input → output` is a unity pass-through, so a cable patched *into* an engine
 * node (a send into the choir bus, a pre-engine insert) sums with what the
 * engine renders. The engine itself attaches to `output`.
 */
export class EngineVoiceSocket {
    readonly input: GainNode;
    readonly output: GainNode;
    readonly nodeId: GraphNodeId;
    readonly factory: EngineVoiceFactory;
    readonly voice: string | null;
    private readonly sources = new Set<EngineOutput>();

    constructor(
        context: BaseAudioContext,
        nodeId: GraphNodeId,
        factory: EngineVoiceFactory,
        voice: string | null,
    ) {
        this.nodeId = nodeId;
        this.factory = factory;
        this.voice = voice;
        this.input = context.createGain();
        this.output = context.createGain();
        this.input.connect(this.output);
    }

    /** Plug an engine output in. Idempotent per source. */
    attach(source: EngineOutput): void {
        if (this.sources.has(source)) return;
        source.connect(this.output);
        this.sources.add(source);
    }

    /** Forget the attached sources; the engine disconnects its own node on cleanup. */
    detachAll(): void {
        this.sources.clear();
    }

    get isAttached(): boolean {
        return this.sources.size > 0;
    }

    get attachedCount(): number {
        return this.sources.size;
    }
}

export interface EngineVoiceRequest {
    nodeId: GraphNodeId;
    factory: EngineVoiceFactory;
    voice: string | null;
}

/**
 * Builds the socket for an engine node. Injected through
 * `CompileGraphOptions.createEngineVoice` so tests can stub it and an offline
 * render can build its own; returning `null` omits the node and the compiler
 * bridges its edges, exactly as for a missing master limiter.
 */
export type EngineVoiceProvider = (
    context: BaseAudioContext,
    request: EngineVoiceRequest,
) => EngineVoiceSocket | null;

export const defaultEngineVoiceProvider: EngineVoiceProvider = (context, request) =>
    new EngineVoiceSocket(context, request.nodeId, request.factory, request.voice);

/** The `voice` an engine node was declared for, or null for a singleton. */
export function engineVoiceOf(spec: Pick<GraphNodeSpec, 'config'>): string | null {
    const voice = (spec.config as EngineVoiceConfig | undefined)?.voice;
    return typeof voice === 'string' && voice.length > 0 ? voice : null;
}

/** Every engine socket in a compiled graph, in config order. */
export function listEngineVoices(graph: Pick<CompiledAudioGraph, 'ports'>): EngineVoiceSocket[] {
    const sockets: EngineVoiceSocket[] = [];
    for (const port of graph.ports.values()) {
        if (port.engineSocket) sockets.push(port.engineSocket);
    }
    return sockets;
}

/**
 * Find the socket an engine attaches to — by factory and voice rather than by
 * node id, so a patch is free to name (and label) its engine nodes.
 */
export function findEngineVoice(
    graph: Pick<CompiledAudioGraph, 'ports'>,
    factory: EngineVoiceFactory,
    voice: string | null = null,
): EngineVoiceSocket | undefined {
    for (const port of graph.ports.values()) {
        const socket = port.engineSocket;
        if (socket && socket.factory === factory && socket.voice === voice) return socket;
    }
    return undefined;
}
