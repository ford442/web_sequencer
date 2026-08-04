/**
 * Serialization for user patches, stored in the song / autosave payload.
 *
 * Two rules shape this module:
 *
 *  1. **Never trust what comes back.** A stored graph is user-editable JSON
 *     from localStorage or a shared song file. Deserialization re-validates
 *     every field and returns `null` rather than handing a malformed config to
 *     the compiler, which would throw somewhere deep in audio init.
 *  2. **A stock preset costs nothing.** When the patch is untouched, only the
 *     preset id is written, so autosave payloads do not grow for the many users
 *     who never open the patch bay.
 */

import type {
    AudioGraphConfig,
    GraphEdgeSpec,
    GraphNodeFactory,
    GraphNodeRole,
    GraphNodeSpec,
} from './types';
import { validateGraph } from './graphOps';

export const GRAPH_SCHEMA_VERSION = 1;

export interface SerializedAudioGraph {
    /** Schema version of this envelope, for future migrations. */
    schemaVersion: number;
    /** Preset the patch started from. */
    presetId: string;
    /**
     * Full graph, present only when the user edited the preset. Absent means
     * "stock preset" and the loader rebuilds from the registry.
     */
    graph?: AudioGraphConfig;
}

const KNOWN_FACTORIES: ReadonlySet<string> = new Set<GraphNodeFactory>([
    'waveShaper',
    'biquadFilter',
    'dynamicsCompressor',
    'gain',
    'stereoPanner',
    'analyser',
    'convolver',
    'delay',
    'trackMonitor',
    'masterLimiter',
    'destination',
]);

const KNOWN_ROLES: ReadonlySet<string> = new Set<GraphNodeRole>([
    'masterFxInput',
    'masterDryInput',
    'masterOutput',
    'masterLimiter',
    'trackBus',
    'trackAnalyser',
    'auxReturn',
    'choirBus',
    'internal',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseNode(raw: unknown): GraphNodeSpec | null {
    if (!isRecord(raw)) return null;
    const { id, factory } = raw;
    if (typeof id !== 'string' || id.length === 0) return null;
    if (typeof factory !== 'string' || !KNOWN_FACTORIES.has(factory)) return null;

    const node: GraphNodeSpec = { id, factory: factory as GraphNodeFactory };
    if (typeof raw.role === 'string' && KNOWN_ROLES.has(raw.role)) {
        node.role = raw.role as GraphNodeRole;
    }
    if (isRecord(raw.config)) {
        // Node configs are plain scalars/strings consumed by the factory map;
        // anything unexpected is dropped by the factory's own defaults.
        node.config = raw.config as GraphNodeSpec['config'];
    }
    if (typeof raw.label === 'string') node.label = raw.label;
    if (raw.fixed === true) node.fixed = true;
    if (
        isRecord(raw.position) &&
        typeof raw.position.x === 'number' &&
        typeof raw.position.y === 'number' &&
        Number.isFinite(raw.position.x) &&
        Number.isFinite(raw.position.y)
    ) {
        node.position = { x: raw.position.x, y: raw.position.y };
    }
    return node;
}

function parseEdge(raw: unknown): GraphEdgeSpec | null {
    if (!isRecord(raw)) return null;
    const { from, to } = raw;
    if (typeof from !== 'string' || typeof to !== 'string') return null;

    const edge: GraphEdgeSpec = { from, to };
    if (typeof raw.gain === 'number' && Number.isFinite(raw.gain) && raw.gain >= 0) {
        edge.gain = raw.gain;
    }
    if (raw.feedback === true) edge.feedback = true;
    return edge;
}

/** Parse an untrusted graph object. Returns `null` if it is not usable. */
export function parseAudioGraphConfig(raw: unknown): AudioGraphConfig | null {
    if (!isRecord(raw)) return null;
    if (typeof raw.id !== 'string' || typeof raw.name !== 'string') return null;
    if (!Array.isArray(raw.nodes) || !Array.isArray(raw.edges)) return null;

    const nodes: GraphNodeSpec[] = [];
    for (const entry of raw.nodes) {
        const node = parseNode(entry);
        if (!node) return null;
        nodes.push(node);
    }

    const edges: GraphEdgeSpec[] = [];
    for (const entry of raw.edges) {
        const edge = parseEdge(entry);
        if (!edge) return null;
        edges.push(edge);
    }

    const config: AudioGraphConfig = { id: raw.id, name: raw.name, nodes, edges };
    if (typeof raw.presetId === 'string') config.presetId = raw.presetId;

    return validateGraph(config).valid ? config : null;
}

/**
 * Write the patch for the song payload.
 *
 * `isModified` decides whether the whole graph is stored or just the preset
 * reference; callers pass the result of comparing against the stock preset.
 */
export function serializeAudioGraph(
    config: AudioGraphConfig,
    isModified: boolean,
): SerializedAudioGraph {
    const presetId = config.presetId ?? config.id;
    return isModified
        ? { schemaVersion: GRAPH_SCHEMA_VERSION, presetId, graph: config }
        : { schemaVersion: GRAPH_SCHEMA_VERSION, presetId };
}

export interface DeserializedGraph {
    presetId: string;
    /** `null` when the stored patch was stock or unusable — load the preset. */
    graph: AudioGraphConfig | null;
}

/**
 * Read a stored patch. Never throws: a corrupted or future-schema entry falls
 * back to `{ presetId, graph: null }` so the caller loads the stock preset
 * instead of failing audio initialisation.
 */
export function deserializeAudioGraph(
    raw: unknown,
    fallbackPresetId: string,
): DeserializedGraph {
    if (!isRecord(raw)) return { presetId: fallbackPresetId, graph: null };

    const presetId = typeof raw.presetId === 'string' ? raw.presetId : fallbackPresetId;
    if (raw.schemaVersion !== GRAPH_SCHEMA_VERSION) {
        // Unknown schema: keep the preset reference, discard the patch.
        return { presetId, graph: null };
    }
    if (raw.graph === undefined) return { presetId, graph: null };

    return { presetId, graph: parseAudioGraphConfig(raw.graph) };
}

/** Structural equality — used to decide whether a patch needs storing. */
export function graphsEqual(a: AudioGraphConfig, b: AudioGraphConfig): boolean {
    if (a.nodes.length !== b.nodes.length || a.edges.length !== b.edges.length) return false;

    const nodeKey = (node: GraphNodeSpec) =>
        JSON.stringify({ id: node.id, factory: node.factory, role: node.role, config: node.config });
    const edgeKeyOf = (edge: GraphEdgeSpec) =>
        JSON.stringify({ from: edge.from, to: edge.to, gain: edge.gain, feedback: edge.feedback });

    const aNodes = a.nodes.map(nodeKey).sort();
    const bNodes = b.nodes.map(nodeKey).sort();
    if (aNodes.some((key, index) => key !== bNodes[index])) return false;

    // Edge order is meaningful (it fixes connection order) so compare in place.
    return a.edges.every((edge, index) => edgeKeyOf(edge) === edgeKeyOf(b.edges[index]));
}
