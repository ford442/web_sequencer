/**
 * Pure edit operations and validation for `AudioGraphConfig`.
 *
 * The patch bay never mutates a config in place: every operation returns a new
 * config, which keeps undo/redo, React state and "is this patch valid?" checks
 * trivial. Nothing here touches Web Audio — `compileGraph` remains the only
 * module that talks to an AudioContext.
 */

import type {
    AudioGraphConfig,
    GraphEdgeSpec,
    GraphNodeId,
    GraphNodeSpec,
} from './types';

/** Stable key for an edge, also used to index compiled send gains. */
export function edgeKey(from: GraphNodeId, to: GraphNodeId): string {
    return `${from}→${to}`;
}

export type GraphValidationCode =
    | 'duplicate-node'
    | 'unknown-node'
    | 'self-connection'
    | 'duplicate-edge'
    | 'cycle'
    | 'invalid-gain'
    | 'no-destination';

export interface GraphValidationIssue {
    code: GraphValidationCode;
    message: string;
    /** Node ids involved, for highlighting in the editor. */
    nodes: GraphNodeId[];
}

export interface GraphValidationResult {
    valid: boolean;
    issues: GraphValidationIssue[];
}

/**
 * Find a cycle in the graph, ignoring edges explicitly marked `feedback`.
 *
 * Returns the node ids on the cycle (in visit order) or `null`. Feedback edges
 * are excluded because a delay line feeding itself is a legitimate — and in
 * this repo, load-bearing — audio topology, whereas any other loop would make
 * Web Audio produce silence or run away.
 */
export function findCycle(config: AudioGraphConfig): GraphNodeId[] | null {
    const adjacency = new Map<GraphNodeId, GraphNodeId[]>();
    for (const node of config.nodes) adjacency.set(node.id, []);
    for (const edge of config.edges) {
        if (edge.feedback) continue;
        const list = adjacency.get(edge.from);
        if (list) list.push(edge.to);
    }

    const WHITE = 0;
    const GREY = 1;
    const BLACK = 2;
    const colour = new Map<GraphNodeId, number>();
    for (const id of adjacency.keys()) colour.set(id, WHITE);
    const stack: GraphNodeId[] = [];

    function visit(id: GraphNodeId): GraphNodeId[] | null {
        colour.set(id, GREY);
        stack.push(id);
        for (const next of adjacency.get(id) ?? []) {
            const state = colour.get(next);
            if (state === GREY) {
                // Trim the stack down to where the loop closes.
                const start = stack.indexOf(next);
                return [...stack.slice(start), next];
            }
            if (state === WHITE) {
                const cycle = visit(next);
                if (cycle) return cycle;
            }
        }
        stack.pop();
        colour.set(id, BLACK);
        return null;
    }

    for (const id of adjacency.keys()) {
        if (colour.get(id) !== WHITE) continue;
        const cycle = visit(id);
        if (cycle) return cycle;
    }
    return null;
}

/** Check structural integrity of a config before it is compiled or saved. */
export function validateGraph(config: AudioGraphConfig): GraphValidationResult {
    const issues: GraphValidationIssue[] = [];
    const seen = new Set<GraphNodeId>();

    for (const node of config.nodes) {
        if (seen.has(node.id)) {
            issues.push({
                code: 'duplicate-node',
                message: `Duplicate node id "${node.id}"`,
                nodes: [node.id],
            });
        }
        seen.add(node.id);
    }

    // `destination` is implicit in the compiler, so treat it as always present.
    const known = new Set<GraphNodeId>([...seen, 'destination']);
    const edgeKeys = new Set<string>();

    for (const edge of config.edges) {
        if (!known.has(edge.from) || !known.has(edge.to)) {
            issues.push({
                code: 'unknown-node',
                message: `Edge ${edge.from} → ${edge.to} references a node that does not exist`,
                nodes: [edge.from, edge.to],
            });
            continue;
        }
        if (edge.from === edge.to) {
            issues.push({
                code: 'self-connection',
                message: `"${edge.from}" cannot connect to itself`,
                nodes: [edge.from],
            });
        }
        const key = edgeKey(edge.from, edge.to);
        if (edgeKeys.has(key)) {
            issues.push({
                code: 'duplicate-edge',
                message: `Duplicate connection ${edge.from} → ${edge.to}`,
                nodes: [edge.from, edge.to],
            });
        }
        edgeKeys.add(key);

        if (edge.gain !== undefined && !(Number.isFinite(edge.gain) && edge.gain >= 0)) {
            issues.push({
                code: 'invalid-gain',
                message: `Send level for ${edge.from} → ${edge.to} must be a finite value ≥ 0`,
                nodes: [edge.from, edge.to],
            });
        }
    }

    const cycle = findCycle(config);
    if (cycle) {
        issues.push({
            code: 'cycle',
            message: `Feedback loop: ${cycle.join(' → ')}. Mark the closing connection as feedback if it is intentional.`,
            nodes: cycle,
        });
    }

    if (!config.edges.some((edge) => edge.to === 'destination')) {
        issues.push({
            code: 'no-destination',
            message: 'Nothing reaches the destination — the patch would be silent',
            nodes: ['destination'],
        });
    }

    return { valid: issues.length === 0, issues };
}

/** Shallow structural clone — enough for a config of plain data. */
function cloneConfig(config: AudioGraphConfig): AudioGraphConfig {
    return {
        ...config,
        nodes: config.nodes.map((node) => ({ ...node })),
        edges: config.edges.map((edge) => ({ ...edge })),
    };
}

export interface GraphEditResult {
    config: AudioGraphConfig;
    /** Unchanged input config plus a reason when the edit was rejected. */
    rejected?: GraphValidationIssue;
}

/**
 * Connect two nodes, optionally with a send level.
 *
 * Rejected (config returned unchanged) when the edge already exists or would
 * introduce a cycle — the patch bay surfaces `rejected.message` rather than
 * letting an invalid graph reach the audio thread.
 */
export function addConnection(
    config: AudioGraphConfig,
    from: GraphNodeId,
    to: GraphNodeId,
    options: { gain?: number; feedback?: boolean } = {},
): GraphEditResult {
    const next = cloneConfig(config);
    const edge: GraphEdgeSpec = { from, to };
    if (options.gain !== undefined) edge.gain = options.gain;
    if (options.feedback) edge.feedback = true;
    next.edges.push(edge);

    const result = validateGraph(next);
    const blocking = result.issues.find(
        (issue) =>
            issue.code === 'cycle' ||
            issue.code === 'duplicate-edge' ||
            issue.code === 'self-connection' ||
            issue.code === 'unknown-node' ||
            issue.code === 'invalid-gain',
    );
    if (blocking) return { config, rejected: blocking };
    return { config: next };
}

/** Remove a connection. A missing edge is a no-op, not an error. */
export function removeConnection(
    config: AudioGraphConfig,
    from: GraphNodeId,
    to: GraphNodeId,
): AudioGraphConfig {
    const next = cloneConfig(config);
    next.edges = next.edges.filter((edge) => !(edge.from === from && edge.to === to));
    return next;
}

/** Set the send level on an existing connection (linear, clamped ≥ 0). */
export function setConnectionGain(
    config: AudioGraphConfig,
    from: GraphNodeId,
    to: GraphNodeId,
    gain: number,
): AudioGraphConfig {
    const safe = Number.isFinite(gain) ? Math.max(0, gain) : 1;
    const next = cloneConfig(config);
    next.edges = next.edges.map((edge) =>
        edge.from === from && edge.to === to ? { ...edge, gain: safe } : edge,
    );
    return next;
}

/** Add a node. Rejected when the id is already taken. */
export function addNode(config: AudioGraphConfig, node: GraphNodeSpec): GraphEditResult {
    if (config.nodes.some((existing) => existing.id === node.id)) {
        return {
            config,
            rejected: {
                code: 'duplicate-node',
                message: `A node called "${node.id}" already exists`,
                nodes: [node.id],
            },
        };
    }
    const next = cloneConfig(config);
    next.nodes.push({ ...node });
    return { config: next };
}

/**
 * Remove a node and every edge touching it.
 *
 * Fixed nodes (the preset skeleton) are refused: playback code resolves them by
 * id and role, so deleting one would break routing in a way the patch bay
 * cannot express.
 */
export function removeNode(config: AudioGraphConfig, id: GraphNodeId): GraphEditResult {
    const node = config.nodes.find((candidate) => candidate.id === id);
    if (!node) {
        return {
            config,
            rejected: { code: 'unknown-node', message: `No node called "${id}"`, nodes: [id] },
        };
    }
    if (node.fixed) {
        return {
            config,
            rejected: {
                code: 'unknown-node',
                message: `"${node.label ?? id}" is part of the preset and cannot be removed`,
                nodes: [id],
            },
        };
    }
    const next = cloneConfig(config);
    next.nodes = next.nodes.filter((candidate) => candidate.id !== id);
    next.edges = next.edges.filter((edge) => edge.from !== id && edge.to !== id);
    return { config: next };
}

/** Move a node in the editor canvas. Purely cosmetic, but persisted. */
export function setNodePosition(
    config: AudioGraphConfig,
    id: GraphNodeId,
    position: { x: number; y: number },
): AudioGraphConfig {
    const next = cloneConfig(config);
    next.nodes = next.nodes.map((node) =>
        node.id === id ? { ...node, position: { ...position } } : node,
    );
    return next;
}

/** Look up an edge, if present. */
export function findEdge(
    config: AudioGraphConfig,
    from: GraphNodeId,
    to: GraphNodeId,
): GraphEdgeSpec | undefined {
    return config.edges.find((edge) => edge.from === from && edge.to === to);
}
