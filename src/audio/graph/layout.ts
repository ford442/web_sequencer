/**
 * Automatic layout for the patch bay canvas.
 *
 * Nodes carry an optional persisted `position`; everything else is placed by
 * signal flow, so a freshly opened patch reads left-to-right (sources → master
 * chain → output) instead of as a pile. Layering is a longest-path depth,
 * which puts each node to the right of everything feeding it.
 */

import type { AudioGraphConfig, GraphNodeId } from './types';

export const NODE_WIDTH = 132;
export const NODE_HEIGHT = 42;
export const COLUMN_GAP = 76;
export const ROW_GAP = 22;
export const CANVAS_PADDING = 24;

export interface NodeLayout {
    id: GraphNodeId;
    x: number;
    y: number;
    /** False when the position came from the persisted config. */
    auto: boolean;
}

export interface GraphLayout {
    nodes: Map<GraphNodeId, NodeLayout>;
    width: number;
    height: number;
}

/**
 * Depth of each node = longest path from any source, ignoring feedback edges
 * (which would otherwise make the depth unbounded).
 */
function computeDepths(config: AudioGraphConfig): Map<GraphNodeId, number> {
    const incoming = new Map<GraphNodeId, GraphNodeId[]>();
    const ids = new Set<GraphNodeId>(config.nodes.map((node) => node.id));
    ids.add('destination');
    for (const id of ids) incoming.set(id, []);
    for (const edge of config.edges) {
        if (edge.feedback) continue;
        incoming.get(edge.to)?.push(edge.from);
    }

    const depths = new Map<GraphNodeId, number>();
    const visiting = new Set<GraphNodeId>();

    function depthOf(id: GraphNodeId): number {
        const cached = depths.get(id);
        if (cached !== undefined) return cached;
        if (visiting.has(id)) return 0; // defensive: validation rejects real cycles
        visiting.add(id);

        let depth = 0;
        for (const source of incoming.get(id) ?? []) {
            depth = Math.max(depth, depthOf(source) + 1);
        }
        visiting.delete(id);
        depths.set(id, depth);
        return depth;
    }

    for (const id of ids) depthOf(id);
    return depths;
}

/** Place every node, honouring persisted positions where present. */
export function layoutGraph(config: AudioGraphConfig): GraphLayout {
    const depths = computeDepths(config);
    const byDepth = new Map<number, GraphNodeId[]>();

    const allNodes = [...config.nodes];
    if (!allNodes.some((node) => node.id === 'destination')) {
        allNodes.push({ id: 'destination', factory: 'destination', label: 'Output', fixed: true });
    }

    for (const node of allNodes) {
        const depth = depths.get(node.id) ?? 0;
        const bucket = byDepth.get(depth);
        if (bucket) bucket.push(node.id);
        else byDepth.set(depth, [node.id]);
    }

    const nodes = new Map<GraphNodeId, NodeLayout>();
    let width = 0;
    let height = 0;

    for (const [depth, bucket] of byDepth) {
        bucket.forEach((id, row) => {
            const spec = allNodes.find((node) => node.id === id);
            const auto = spec?.position === undefined;
            const x = spec?.position?.x ?? CANVAS_PADDING + depth * (NODE_WIDTH + COLUMN_GAP);
            const y = spec?.position?.y ?? CANVAS_PADDING + row * (NODE_HEIGHT + ROW_GAP);
            nodes.set(id, { id, x, y, auto });
            width = Math.max(width, x + NODE_WIDTH + CANVAS_PADDING);
            height = Math.max(height, y + NODE_HEIGHT + CANVAS_PADDING);
        });
    }

    return { nodes, width, height };
}

/** Output port anchor (right edge, vertically centred). */
export function outputPort(layout: NodeLayout): { x: number; y: number } {
    return { x: layout.x + NODE_WIDTH, y: layout.y + NODE_HEIGHT / 2 };
}

/** Input port anchor (left edge, vertically centred). */
export function inputPort(layout: NodeLayout): { x: number; y: number } {
    return { x: layout.x, y: layout.y + NODE_HEIGHT / 2 };
}

/**
 * Cable path: a horizontal cubic bezier, with extra sag when the cable runs
 * backwards so a feedback send stays readable instead of hiding under nodes.
 */
export function cablePath(
    from: { x: number; y: number },
    to: { x: number; y: number },
): string {
    const distance = Math.abs(to.x - from.x);
    const backwards = to.x < from.x;
    const reach = backwards ? Math.max(70, distance * 0.6) : Math.max(36, distance * 0.45);
    const sag = backwards ? 46 : 0;
    return `M ${from.x} ${from.y} C ${from.x + reach} ${from.y + sag}, ${to.x - reach} ${to.y + sag}, ${to.x} ${to.y}`;
}
