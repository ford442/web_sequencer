import { describe, expect, it } from 'vitest';
import {
    CLASSIC_ELECTRIBE_GRAPH,
    MASTER_CHAIN_CONNECTIONS,
    MASTER_CHAIN_ORDER,
    MASTER_CHAIN_ORDER_WITH_LIMITER,
    compileAudioGraph,
    extractMasterChainConnections,
} from '../index';

interface TrackedNode {
    id: string;
    connect: (dest: TrackedNode | AudioDestinationNode) => void;
}

function createTrackingContext(): {
    context: AudioContext;
    nodes: Map<string, TrackedNode>;
    connections: Array<{ from: string; to: string }>;
    nodeId: (node: TrackedNode) => string;
} {
    const nodes = new Map<string, TrackedNode>();
    const connections: Array<{ from: string; to: string }> = [];
    let counter = 0;

    const makeNode = (factory: string): TrackedNode => {
        const id = `${factory}_${counter++}`;
        const node: TrackedNode = {
            id,
            connect(dest: TrackedNode | AudioDestinationNode) {
                const toId = 'id' in dest ? dest.id : 'destination';
                connections.push({ from: id, to: toId });
            },
        };
        nodes.set(id, node);
        return node;
    };

    const context = {
        currentTime: 0,
        sampleRate: 48000,
        destination: { id: 'destination' } as AudioDestinationNode & { id: string },
        createGain: () => {
            const node = makeNode('gain');
            return Object.assign(node, {
                gain: { value: 1, setValueAtTime: () => {} },
                disconnect: () => {},
            });
        },
        createWaveShaper: () => makeNode('waveShaper'),
        createBiquadFilter: () => {
            const node = makeNode('biquad');
            return Object.assign(node, {
                type: 'lowpass',
                frequency: { setValueAtTime: () => {} },
                Q: { setValueAtTime: () => {} },
                gain: { setValueAtTime: () => {} },
            });
        },
        createDynamicsCompressor: () =>
            Object.assign(makeNode('compressor'), {
                threshold: { setValueAtTime: () => {} },
                knee: { setValueAtTime: () => {} },
                ratio: { setValueAtTime: () => {} },
                attack: { setValueAtTime: () => {} },
                release: { setValueAtTime: () => {} },
            }),
        createStereoPanner: () =>
            Object.assign(makeNode('panner'), {
                pan: { setValueAtTime: () => {} },
            }),
        createAnalyser: () =>
            Object.assign(makeNode('analyser'), {
                fftSize: 256,
                smoothingTimeConstant: 0.5,
            }),
        createConvolver: () => makeNode('convolver'),
        createDelay: () =>
            Object.assign(makeNode('delay'), {
                delayTime: { value: 0 },
            }),
        createBuffer: (channels: number, length: number, sampleRate: number) => ({
            numberOfChannels: channels,
            length,
            sampleRate,
            getChannelData: () => new Float32Array(length),
        }),
    } as unknown as AudioContext;

    const nodeId = (node: TrackedNode) => node.id;

    return { context, nodes, connections, nodeId };
}

describe('CLASSIC_ELECTRIBE_GRAPH config', () => {
    it('declares the expected master chain node ids', () => {
        const nodeIds = CLASSIC_ELECTRIBE_GRAPH.nodes.map((n) => n.id);
        for (const id of MASTER_CHAIN_ORDER) {
            expect(nodeIds).toContain(id);
        }
    });

    it('declares master chain edges in series order', () => {
        expect(MASTER_CHAIN_CONNECTIONS).toEqual([
            ['masterSaturation', 'bassSidechainEQ'],
            ['bassSidechainEQ', 'sidechainGain'],
            ['sidechainGain', 'masterCompressor'],
            ['masterCompressor', 'masterGain'],
            ['masterGain', 'masterPanner'],
            ['masterPanner', 'destination'],
        ]);
    });

    it('routes track buses and aux returns to masterFxInput', () => {
        const fxInputEdges = CLASSIC_ELECTRIBE_GRAPH.edges.filter((e) => e.to === 'masterSaturation');
        const sources = fxInputEdges.map((e) => e.from).sort();
        expect(sources).toEqual([
            'delay',
            'reverbHall',
            'reverbPlate',
            'reverbRoom',
            'samplerBus',
            'synthABus',
            'synthBBus',
        ]);
    });

    it('routes choir buses to masterDryInput (masterGain)', () => {
        const dryEdges = CLASSIC_ELECTRIBE_GRAPH.edges.filter((e) => e.to === 'masterGain');
        const sources = dryEdges.map((e) => e.from).sort();
        expect(sources).toEqual(['choirLeftPanner', 'choirRightPanner', 'masterCompressor']);
    });
});

describe('compileAudioGraph', () => {
    it('connects master chain nodes in declarative edge order', () => {
        const graph = compileAudioGraph(
            new AudioContext(),
            {
                id: 'test-master',
                name: 'Test Master',
                nodes: CLASSIC_ELECTRIBE_GRAPH.nodes.filter((n) =>
                    MASTER_CHAIN_ORDER.includes(n.id) || n.id === 'masterAnalyser',
                ),
                // The master limiter node is only compiled when the host
                // supplies a worklet; its edges stay in so the compiler has to
                // bridge masterPanner straight to the destination.
                edges: CLASSIC_ELECTRIBE_GRAPH.edges.filter(
                    (e) =>
                        MASTER_CHAIN_ORDER.includes(e.from) ||
                        e.from === 'masterLimiter' ||
                        e.from === 'masterGain' && e.to === 'masterAnalyser',
                ),
            },
        );

        const masterConnections = extractMasterChainConnections(graph.connectionLog);
        expect(masterConnections.map((c) => [c.from, c.to])).toEqual(
            MASTER_CHAIN_CONNECTIONS.map(([from, to]) => [from, to]),
        );
    });

    it('records connection log with monotonic order indices', () => {
        const graph = compileAudioGraph(new AudioContext(), CLASSIC_ELECTRIBE_GRAPH);
        const orders = graph.connectionLog.map((c) => c.order);
        expect(orders).toEqual([...orders].sort((a, b) => a - b));
        expect(new Set(orders).size).toBe(orders.length);
    });

    it('assigns masterFxInput and masterDryInput roles', () => {
        const graph = compileAudioGraph(new AudioContext(), CLASSIC_ELECTRIBE_GRAPH);
        expect(graph.getRoleNode('masterFxInput')).toBe(graph.getNode('masterSaturation'));
        expect(graph.getRoleNode('masterDryInput')).toBe(graph.getNode('masterGain'));
    });

    it('creates track monitor analysers for each track bus', () => {
        const graph = compileAudioGraph(new AudioContext(), CLASSIC_ELECTRIBE_GRAPH);
        expect(graph.analysers.has('synthABus')).toBe(true);
        expect(graph.analysers.has('synthBBus')).toBe(true);
        expect(graph.analysers.has('samplerBus')).toBe(true);
    });

    it('wires delay feedback loop before delay return to master', () => {
        const graph = compileAudioGraph(new AudioContext(), CLASSIC_ELECTRIBE_GRAPH);
        const delayEdges = graph.connectionLog.filter((c) => c.from === 'delay' || c.to === 'delay');
        const feedbackIdx = delayEdges.findIndex(
            (c) => c.from === 'delay' && c.to === 'delayFeedback',
        );
        const returnIdx = delayEdges.findIndex(
            (c) => c.from === 'delay' && c.to === 'masterSaturation',
        );
        expect(feedbackIdx).toBeGreaterThanOrEqual(0);
        expect(returnIdx).toBeGreaterThan(feedbackIdx);
    });

    it('compiles full classic graph with tracking context in correct order', () => {
        const { context } = createTrackingContext();
        const impulse = context.createBuffer(2, 100, 48000);

        const graph = compileAudioGraph(context, CLASSIC_ELECTRIBE_GRAPH, {
            createReverbImpulse: () => impulse,
        });
        const masterPairs = extractMasterChainConnections(graph.connectionLog);
        expect(masterPairs).toHaveLength(MASTER_CHAIN_CONNECTIONS.length);
        // Without a master limiter node its two edges collapse into one.
        expect(graph.connectionLog.length).toBe(CLASSIC_ELECTRIBE_GRAPH.edges.length - 1);
    });
});

describe('master limiter stage', () => {
    it('declares the limiter as the last insert before the destination', () => {
        const toDestination = CLASSIC_ELECTRIBE_GRAPH.edges.filter((e) => e.to === 'destination');
        expect(toDestination).toEqual([{ from: 'masterLimiter', to: 'destination' }]);
        expect(MASTER_CHAIN_ORDER_WITH_LIMITER).toContain('masterLimiter');
        // Post-compressor: nothing in the master chain sits after the limiter.
        const fromLimiter = CLASSIC_ELECTRIBE_GRAPH.edges.filter((e) => e.from === 'masterLimiter');
        expect(fromLimiter).toEqual([{ from: 'masterLimiter', to: 'destination' }]);
    });

    it('wires masterPanner → masterLimiter → destination when a node is supplied', () => {
        const { context } = createTrackingContext();
        const impulse = context.createBuffer(2, 100, 48000);
        const limiterNode = { id: 'masterLimiter', connect: () => {} } as unknown as AudioNode;

        const graph = compileAudioGraph(context, CLASSIC_ELECTRIBE_GRAPH, {
            createReverbImpulse: () => impulse,
            createMasterLimiterNode: () => limiterNode,
        });

        expect(graph.getNode('masterLimiter')).toBe(limiterNode);
        expect(graph.getRoleNode('masterLimiter')).toBe(limiterNode);
        const pairs = extractMasterChainConnections(graph.connectionLog).map((c) => [c.from, c.to]);
        expect(pairs).toEqual([
            ['masterSaturation', 'bassSidechainEQ'],
            ['bassSidechainEQ', 'sidechainGain'],
            ['sidechainGain', 'masterCompressor'],
            ['masterCompressor', 'masterGain'],
            ['masterGain', 'masterPanner'],
            ['masterPanner', 'masterLimiter'],
            ['masterLimiter', 'destination'],
        ]);
        expect(graph.connectionLog.length).toBe(CLASSIC_ELECTRIBE_GRAPH.edges.length);
    });

    it('bridges masterPanner → destination when the worklet is unavailable', () => {
        const { context } = createTrackingContext();
        const impulse = context.createBuffer(2, 100, 48000);
        const graph = compileAudioGraph(context, CLASSIC_ELECTRIBE_GRAPH, {
            createReverbImpulse: () => impulse,
            createMasterLimiterNode: () => null,
        });

        expect(graph.nodes.has('masterLimiter')).toBe(false);
        const pairs = extractMasterChainConnections(graph.connectionLog).map((c) => [c.from, c.to]);
        expect(pairs).toEqual(MASTER_CHAIN_CONNECTIONS.map(([from, to]) => [from, to]));
    });

    it('routes masterGain to the limiter when the stereo panner is skipped', () => {
        const { context } = createTrackingContext();
        const limiterNode = { id: 'masterLimiter', connect: () => {} } as unknown as AudioNode;
        // Minimal master-only config: the choir panners are unrelated to this
        // fallback and the compiler has no bridge for them.
        const graph = compileAudioGraph(
            context,
            {
                id: 'no-panner',
                name: 'No Panner',
                nodes: CLASSIC_ELECTRIBE_GRAPH.nodes.filter((n) =>
                    MASTER_CHAIN_ORDER_WITH_LIMITER.includes(n.id),
                ),
                edges: CLASSIC_ELECTRIBE_GRAPH.edges.filter(
                    (e) =>
                        MASTER_CHAIN_ORDER_WITH_LIMITER.includes(e.from) &&
                        MASTER_CHAIN_ORDER_WITH_LIMITER.includes(e.to),
                ),
            },
            {
                createMasterLimiterNode: () => limiterNode,
                useStereoPanner: false,
            },
        );

        const pairs = graph.connectionLog.map((c) => [c.from, c.to]);
        expect(pairs).toContainEqual(['masterGain', 'masterLimiter']);
        expect(pairs).toContainEqual(['masterLimiter', 'destination']);
        expect(pairs.some(([from]) => from === 'masterPanner')).toBe(false);
    });
});

describe('extractMasterChainConnections', () => {
    it('filters non-master edges from the connection log', () => {
        const log = [
            { from: 'masterSaturation', to: 'bassSidechainEQ', order: 0 },
            { from: 'synthABus', to: 'masterSaturation', order: 1 },
            { from: 'bassSidechainEQ', to: 'sidechainGain', order: 2 },
        ];
        expect(extractMasterChainConnections(log)).toEqual([
            { from: 'masterSaturation', to: 'bassSidechainEQ' },
            { from: 'bassSidechainEQ', to: 'sidechainGain' },
        ]);
    });
});
