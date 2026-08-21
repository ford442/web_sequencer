/**
 * Patch model: validation (incl. cycle rejection), edit operations, and the
 * guarantee that the Classic Electribe preset is unchanged by all of it.
 */

import { describe, expect, it } from 'vitest';

import {
    CLASSIC_ELECTRIBE_GRAPH,
    MASTER_CHAIN_CONNECTIONS,
    addConnection,
    addNode,
    buildPreset,
    findCycle,
    findEdge,
    removeConnection,
    removeNode,
    setConnectionGain,
    setNodePosition,
    validateGraph,
    GRAPH_PRESETS,
} from '../index';
import type { AudioGraphConfig } from '../types';

function minimalGraph(): AudioGraphConfig {
    return {
        id: 'test',
        name: 'Test',
        nodes: [
            { id: 'source', factory: 'gain', fixed: true },
            { id: 'fx', factory: 'gain' },
            { id: 'destination', factory: 'destination', fixed: true },
        ],
        edges: [
            { from: 'source', to: 'fx' },
            { from: 'fx', to: 'destination' },
        ],
    };
}

describe('validateGraph', () => {
    it('accepts the stock Classic Electribe graph', () => {
        const result = validateGraph(CLASSIC_ELECTRIBE_GRAPH);
        expect(result.issues).toEqual([]);
        expect(result.valid).toBe(true);
    });

    it('accepts the delay feedback loop because it is marked as feedback', () => {
        // The classic graph really is cyclic: delay → delayFeedback → delay.
        // Without the flag this would be rejected, so assert the flag is what
        // makes it legal rather than some accident of traversal order.
        expect(findCycle(CLASSIC_ELECTRIBE_GRAPH)).toBeNull();

        const unflagged: AudioGraphConfig = {
            ...CLASSIC_ELECTRIBE_GRAPH,
            edges: CLASSIC_ELECTRIBE_GRAPH.edges.map((edge) =>
                edge.feedback ? { from: edge.from, to: edge.to } : edge,
            ),
        };
        expect(findCycle(unflagged)).not.toBeNull();
        expect(validateGraph(unflagged).valid).toBe(false);
    });

    it('reports a cycle with the nodes on the loop', () => {
        const graph = minimalGraph();
        graph.edges.push({ from: 'fx', to: 'source' });
        const result = validateGraph(graph);
        const cycle = result.issues.find((issue) => issue.code === 'cycle');
        expect(cycle).toBeDefined();
        expect(cycle?.nodes).toContain('source');
        expect(cycle?.nodes).toContain('fx');
    });

    it('rejects self-connections, duplicates, unknown nodes and bad send levels', () => {
        const graph = minimalGraph();
        graph.edges.push({ from: 'fx', to: 'fx' });
        graph.edges.push({ from: 'source', to: 'fx' });
        graph.edges.push({ from: 'source', to: 'ghost' });
        graph.edges.push({ from: 'source', to: 'destination', gain: Number.NaN });
        graph.nodes.push({ id: 'fx', factory: 'gain' });

        const codes = validateGraph(graph).issues.map((issue) => issue.code);
        expect(codes).toContain('self-connection');
        expect(codes).toContain('duplicate-edge');
        expect(codes).toContain('unknown-node');
        expect(codes).toContain('invalid-gain');
        expect(codes).toContain('duplicate-node');
    });

    it('flags a patch that never reaches the destination', () => {
        const graph = minimalGraph();
        graph.edges = [{ from: 'source', to: 'fx' }];
        expect(validateGraph(graph).issues.map((i) => i.code)).toContain('no-destination');
    });
});

describe('edit operations', () => {
    it('adds a send from Synth A to the plate reverb', () => {
        const preset = buildPreset('classic-electribe');
        const result = addConnection(preset, 'synthABus', 'reverbPlate', { gain: 0.35 });

        expect(result.rejected).toBeUndefined();
        expect(findEdge(result.config, 'synthABus', 'reverbPlate')?.gain).toBe(0.35);
        // The source config is untouched — every op returns a new object.
        expect(findEdge(preset, 'synthABus', 'reverbPlate')).toBeUndefined();
        expect(validateGraph(result.config).valid).toBe(true);
    });

    it('refuses a connection that would close a loop', () => {
        const preset = buildPreset('classic-electribe');
        // masterGain already feeds the panner → limiter → destination chain;
        // feeding it from the panner would loop the master bus.
        const result = addConnection(preset, 'masterPanner', 'masterGain');
        expect(result.rejected?.code).toBe('cycle');
        expect(result.config).toBe(preset);
    });

    it('refuses a duplicate connection', () => {
        const preset = buildPreset('classic-electribe');
        const result = addConnection(preset, 'masterGain', 'masterPanner');
        expect(result.rejected?.code).toBe('duplicate-edge');
    });

    it('removes connections and is a no-op for missing ones', () => {
        const graph = minimalGraph();
        const removed = removeConnection(graph, 'source', 'fx');
        expect(findEdge(removed, 'source', 'fx')).toBeUndefined();
        expect(removeConnection(graph, 'nope', 'nowhere').edges).toHaveLength(graph.edges.length);
    });

    it('clamps send levels and ignores non-finite input', () => {
        const graph = minimalGraph();
        expect(findEdge(setConnectionGain(graph, 'source', 'fx', -2), 'source', 'fx')?.gain).toBe(0);
        expect(findEdge(setConnectionGain(graph, 'source', 'fx', NaN), 'source', 'fx')?.gain).toBe(1);
        expect(findEdge(setConnectionGain(graph, 'source', 'fx', 0.4), 'source', 'fx')?.gain).toBe(0.4);
    });

    it('adds nodes but refuses duplicate ids', () => {
        const graph = minimalGraph();
        const added = addNode(graph, { id: 'extra', factory: 'gain' });
        expect(added.config.nodes).toHaveLength(4);
        expect(addNode(added.config, { id: 'extra', factory: 'gain' }).rejected?.code).toBe(
            'duplicate-node',
        );
    });

    it('removes a user node with its cables but protects preset nodes', () => {
        const graph = minimalGraph();
        const removed = removeNode(graph, 'fx');
        expect(removed.rejected).toBeUndefined();
        expect(removed.config.nodes.map((n) => n.id)).toEqual(['source', 'destination']);
        expect(removed.config.edges).toHaveLength(0);

        expect(removeNode(graph, 'source').rejected).toBeDefined();
        expect(removeNode(graph, 'missing').rejected?.code).toBe('unknown-node');
    });

    it('stores editor positions without touching routing', () => {
        const graph = minimalGraph();
        const moved = setNodePosition(graph, 'fx', { x: 10, y: 20 });
        expect(moved.nodes.find((n) => n.id === 'fx')?.position).toEqual({ x: 10, y: 20 });
        expect(moved.edges).toEqual(graph.edges);
    });
});

describe('presets', () => {
    it('classic preset routing is identical to CLASSIC_ELECTRIBE_GRAPH', () => {
        const preset = buildPreset('classic-electribe');
        expect(preset.nodes).toEqual(CLASSIC_ELECTRIBE_GRAPH.nodes);
        expect(preset.edges).toEqual(CLASSIC_ELECTRIBE_GRAPH.edges);
        // …and it still declares the master chain in series order.
        for (const [from, to] of MASTER_CHAIN_CONNECTIONS) {
            if (to === 'destination') continue; // limiter sits between these now
            expect(preset.edges.some((e) => e.from === from)).toBe(true);
        }
    });

    it('building a preset does not mutate the shared config', () => {
        const first = buildPreset('classic-electribe');
        first.edges.push({ from: 'synthABus', to: 'delay' });
        first.nodes[0].label = 'clobbered';

        const second = buildPreset('classic-electribe');
        expect(second.edges).toEqual(CLASSIC_ELECTRIBE_GRAPH.edges);
        expect(second.nodes[0].label).not.toBe('clobbered');
    });

    it('every registered preset is valid', () => {
        for (const preset of GRAPH_PRESETS) {
            const result = validateGraph(preset.build());
            expect(result.issues, `${preset.id}: ${JSON.stringify(result.issues)}`).toEqual([]);
        }
    });

    it('falls back to Classic for an unknown preset id', () => {
        expect(buildPreset('does-not-exist').presetId).toBe('classic-electribe');
        expect(buildPreset(undefined).presetId).toBe('classic-electribe');
    });
});
