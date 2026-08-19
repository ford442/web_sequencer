/**
 * Patch serialization and the live PatchController.
 *
 * The persistence tests treat stored graphs as hostile input: they come from
 * localStorage and shared song files, so a malformed patch must degrade to the
 * preset rather than reaching the compiler.
 */

import { describe, expect, it, vi } from 'vitest';

import {
    CLASSIC_ELECTRIBE_GRAPH,
    GRAPH_SCHEMA_VERSION,
    PatchController,
    addConnection,
    buildPreset,
    compileAudioGraph,
    deserializeAudioGraph,
    graphsEqual,
    parseAudioGraphConfig,
    restorePatchFromSong,
    serializeAudioGraph,
    setActivePatchController,
    getActivePatchController,
} from '../index';
import type { AudioGraphConfig } from '../types';

describe('serialization', () => {
    it('stores only the preset id when the patch is stock', () => {
        const preset = buildPreset('classic-electribe');
        const stored = serializeAudioGraph(preset, false);
        expect(stored).toEqual({
            schemaVersion: GRAPH_SCHEMA_VERSION,
            presetId: 'classic-electribe',
        });
        expect(JSON.stringify(stored).length).toBeLessThan(120);
    });

    it('round-trips a modified patch without losing sends', () => {
        const edited = addConnection(buildPreset('classic-electribe'), 'synthABus', 'reverbHall', {
            gain: 0.42,
        }).config;

        const stored = JSON.parse(JSON.stringify(serializeAudioGraph(edited, true)));
        const { graph, presetId } = deserializeAudioGraph(stored, 'classic-electribe');

        expect(presetId).toBe('classic-electribe');
        expect(graph).not.toBeNull();
        expect(graphsEqual(graph!, edited)).toBe(true);
        expect(graph!.edges.find((e) => e.to === 'reverbHall' && e.from === 'synthABus')?.gain).toBe(
            0.42,
        );
    });

    it('round-trips the classic graph unchanged', () => {
        const stored = JSON.parse(JSON.stringify(serializeAudioGraph(CLASSIC_ELECTRIBE_GRAPH, true)));
        const { graph } = deserializeAudioGraph(stored, 'classic-electribe');
        expect(graphsEqual(graph!, CLASSIC_ELECTRIBE_GRAPH)).toBe(true);
        // Compiled routing must be identical too, not just structurally equal.
        const fromStored = compileAudioGraph(new AudioContext(), graph!);
        const fromSource = compileAudioGraph(new AudioContext(), CLASSIC_ELECTRIBE_GRAPH);
        expect(fromStored.connectionLog).toEqual(fromSource.connectionLog);
    });

    it('rejects malformed graphs instead of passing them to the compiler', () => {
        expect(parseAudioGraphConfig(null)).toBeNull();
        expect(parseAudioGraphConfig({ id: 'x', name: 'y' })).toBeNull();
        expect(
            parseAudioGraphConfig({ id: 'x', name: 'y', nodes: [{ id: 'a' }], edges: [] }),
        ).toBeNull();
        expect(
            parseAudioGraphConfig({
                id: 'x',
                name: 'y',
                nodes: [{ id: 'a', factory: 'evil-node' }],
                edges: [],
            }),
        ).toBeNull();
        // Structurally parseable but cyclic — still refused.
        expect(
            parseAudioGraphConfig({
                id: 'x',
                name: 'y',
                nodes: [
                    { id: 'a', factory: 'gain' },
                    { id: 'b', factory: 'gain' },
                ],
                edges: [
                    { from: 'a', to: 'b' },
                    { from: 'b', to: 'a' },
                    { from: 'b', to: 'destination' },
                ],
            }),
        ).toBeNull();
    });

    it('falls back to the preset for a future schema version', () => {
        const stored = { schemaVersion: GRAPH_SCHEMA_VERSION + 1, presetId: 'classic-electribe', graph: {} };
        expect(deserializeAudioGraph(stored, 'classic-electribe').graph).toBeNull();
    });

    it('survives undefined and junk', () => {
        expect(deserializeAudioGraph(undefined, 'classic-electribe')).toEqual({
            presetId: 'classic-electribe',
            graph: null,
        });
        expect(deserializeAudioGraph('nonsense', 'classic-electribe').graph).toBeNull();
    });
});

describe('restorePatchFromSong', () => {
    it('publishes a controller when the engine has not started yet', () => {
        setActivePatchController(null);
        const result = restorePatchFromSong(undefined);
        expect(getActivePatchController()).not.toBeNull();
        expect(result.config.presetId).toBe('classic-electribe');
        expect(result.fellBack).toBe(false);
        setActivePatchController(null);
    });

    it('reports a fallback when the stored patch was unusable', () => {
        setActivePatchController(null);
        const result = restorePatchFromSong({
            schemaVersion: GRAPH_SCHEMA_VERSION,
            presetId: 'classic-electribe',
            graph: { id: 'broken' } as unknown as AudioGraphConfig,
        });
        expect(result.fellBack).toBe(true);
        expect(result.config.presetId).toBe('classic-electribe');
        setActivePatchController(null);
    });

    it('replaces the config on an already-running controller', () => {
        const controller = new PatchController(buildPreset('classic-electribe'));
        setActivePatchController(controller);

        const edited = addConnection(buildPreset('classic-electribe'), 'synthBBus', 'delay', {
            gain: 0.3,
        }).config;
        const result = restorePatchFromSong(serializeAudioGraph(edited, true));

        expect(result.requiresRebuild).toBe(true);
        expect(controller.getConfig().edges.some((e) => e.from === 'synthBBus' && e.to === 'delay')).toBe(
            true,
        );
        setActivePatchController(null);
    });
});

/** Tracking stand-in for the live audio graph. */
function fakeCompiled() {
    const connections: string[] = [];
    const disconnections: string[] = [];
    const make = (id: string) => ({
        id,
        connect: (target: { id: string }) => connections.push(`${id}->${target.id}`),
        disconnect: (target?: { id: string }) =>
            disconnections.push(target ? `${id}->${target.id}` : `${id}->*`),
    });
    const nodes = new Map<string, ReturnType<typeof make>>();
    for (const id of ['synthABus', 'reverbPlate', 'masterGain']) nodes.set(id, make(id));

    const gainNodes: Array<{ id: string; gain: { value: number } }> = [];
    const context = {
        currentTime: 0,
        createGain: () => {
            const node = {
                ...make(`send${gainNodes.length}`),
                gain: {
                    value: 1,
                    setValueAtTime(value: number) {
                        this.value = value;
                    },
                    cancelScheduledValues: vi.fn(),
                    linearRampToValueAtTime(value: number) {
                        this.value = value;
                    },
                },
            };
            gainNodes.push(node as never);
            return node;
        },
        destination: make('destination'),
    } as unknown as AudioContext;

    const compiled = {
        nodes: nodes as unknown as ReadonlyMap<string, AudioNode>,
        sendGains: new Map<string, GainNode>(),
    } as never;

    return { context, compiled, connections, disconnections, gainNodes };
}

describe('PatchController live editing', () => {
    it('patches a send into the running graph without a rebuild', () => {
        const preset = buildPreset('classic-electribe');
        const controller = new PatchController(preset, preset);
        const { context, compiled, connections } = fakeCompiled();
        controller.attach(context, compiled);

        const outcome = controller.connect('synthABus', 'reverbPlate', 0.5);

        expect(outcome.ok).toBe(true);
        expect(outcome.requiresRebuild).toBeUndefined();
        expect(controller.needsRebuild()).toBe(false);
        // Routed through an implicit send gain: source → send → target.
        expect(connections).toContain('synthABus->send0');
        expect(connections).toContain('send0->reverbPlate');
        expect(controller.isModified()).toBe(true);
    });

    it('refuses a cycle and leaves the live graph alone', () => {
        const preset = buildPreset('classic-electribe');
        const controller = new PatchController(preset, preset);
        const { context, compiled, connections } = fakeCompiled();
        controller.attach(context, compiled);

        const outcome = controller.connect('masterPanner', 'masterGain');
        expect(outcome.ok).toBe(false);
        expect(outcome.rejected?.code).toBe('cycle');
        expect(connections).toHaveLength(0);
        expect(controller.isModified()).toBe(false);
    });

    it('rides a send level on the live gain node', () => {
        const preset = buildPreset('classic-electribe');
        const controller = new PatchController(preset, preset);
        const { context, compiled, gainNodes } = fakeCompiled();
        controller.attach(context, compiled);
        controller.connect('synthABus', 'reverbPlate', 0.5);

        const outcome = controller.setSendLevel('synthABus', 'reverbPlate', 0.8);
        expect(outcome.ok).toBe(true);
        expect(outcome.requiresRebuild).toBeUndefined();
        expect(gainNodes[0].gain.value).toBeCloseTo(0.8, 5);
    });

    it('tears down the send gain when unpatching', () => {
        const preset = buildPreset('classic-electribe');
        const controller = new PatchController(preset, preset);
        const { context, compiled, disconnections } = fakeCompiled();
        controller.attach(context, compiled);
        controller.connect('synthABus', 'reverbPlate', 0.5);

        expect(controller.disconnect('synthABus', 'reverbPlate').ok).toBe(true);
        expect(disconnections).toContain('synthABus->send0');
        expect(disconnections).toContain('send0->*');
        expect(controller.getConfig().edges.some((e) => e.to === 'reverbPlate' && e.from === 'synthABus')).toBe(
            false,
        );
    });

    it('stages node changes for the next rebuild', () => {
        const preset = buildPreset('classic-electribe');
        const controller = new PatchController(preset, preset);
        const { context, compiled } = fakeCompiled();
        controller.attach(context, compiled);

        const added = controller.addNode({ id: 'userDelay', factory: 'delay', label: 'Tape Delay' });
        expect(added.requiresRebuild).toBe(true);
        expect(controller.needsRebuild()).toBe(true);
        expect(controller.removeNode('masterGain').ok).toBe(false);
        expect(controller.removeNode('userDelay').ok).toBe(true);
    });

    it('detaching stops it from touching disposed nodes', () => {
        const preset = buildPreset('classic-electribe');
        const controller = new PatchController(preset, preset);
        const { context, compiled, connections } = fakeCompiled();
        controller.attach(context, compiled);
        controller.detach();

        const outcome = controller.connect('synthABus', 'reverbPlate', 0.5);
        expect(outcome.requiresRebuild).toBe(true);
        expect(connections).toHaveLength(0);
    });

    it('notifies subscribers on every committed edit', () => {
        const preset = buildPreset('classic-electribe');
        const controller = new PatchController(preset, preset);
        const seen: number[] = [];
        const unsubscribe = controller.subscribe((config) => seen.push(config.edges.length));

        const { context, compiled } = fakeCompiled();
        controller.attach(context, compiled);
        controller.connect('synthABus', 'reverbPlate', 0.5);
        controller.disconnect('synthABus', 'reverbPlate');
        unsubscribe();
        controller.connect('synthBBus', 'reverbPlate', 0.5);

        // Initial + add + remove, and nothing after unsubscribe.
        expect(seen).toHaveLength(3);
        expect(seen[1]).toBe(seen[0] + 1);
        expect(seen[2]).toBe(seen[0]);
    });
});
