import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PcfEffect } from '../../../engines/PcfEffect';
import { createMasterPcfProvider, createPcfNodeProvider, disposeLivePcfInserts } from '../../pcf/pcfInsert';
import {
    CLASSIC_ELECTRIBE_GRAPH,
    NODE_PALETTE,
    PCF_NODE_DEFAULTS,
    PatchController,
    compileAudioGraph,
    createPaletteNode,
    deserializeAudioGraph,
    serializeAudioGraph,
    setPcfNodeConfig,
    type AudioGraphConfig,
} from '../index';

interface FakeParam {
    value: number;
    setValueAtTime(value: number): void;
    linearRampToValueAtTime(value: number): void;
    cancelScheduledValues(): void;
}

function param(initial = 1): FakeParam {
    return {
        value: initial,
        setValueAtTime(value) {
            this.value = value;
        },
        linearRampToValueAtTime(value) {
            this.value = value;
        },
        cancelScheduledValues() {},
    };
}

interface FakeNode {
    kind: string;
    outputs: FakeNode[];
    connect(dest: FakeNode): FakeNode;
    disconnect(): void;
}

function fakeContext(): AudioContext {
    const make = (kind: string, extra: object = {}): FakeNode => {
        const node: FakeNode = {
            kind,
            outputs: [],
            connect(dest) {
                node.outputs.push(dest);
                return dest;
            },
            disconnect() {
                node.outputs = [];
            },
            ...extra,
        };
        return node;
    };
    const generic = (kind: string) =>
        new Proxy(make(kind), {
            get: (target, key) =>
                key in target ? target[key as keyof FakeNode] : typeof key === 'string' ? param(0) : undefined,
            set: (target, key, value) => {
                (target as unknown as Record<string | symbol, unknown>)[key] = value;
                return true;
            },
        });
    const known: Record<string, unknown> = {
        currentTime: 0,
        sampleRate: 44_100,
        destination: make('destination'),
        audioWorklet: { addModule: () => Promise.resolve() },
        createGain: () => make('gain', { gain: param(1) }),
        createStereoPanner: () => make('panner', { pan: param(0) }),
    };
    return new Proxy(known, {
        get: (target, key) =>
            key in target
                ? target[key as string]
                : typeof key === 'string' && key.startsWith('create')
                  ? () => generic(key.slice(6))
                  : undefined,
    }) as unknown as AudioContext;
}

const PCF = NODE_PALETTE.find((entry) => entry.factory === 'pcf')!;

/** in → PCF (from the palette) → destination. */
function patchWithPcf(): AudioGraphConfig {
    const empty: AudioGraphConfig = { id: 't', name: 'T', nodes: [], edges: [] };
    const pcf = createPaletteNode(empty, PCF, { cutoff: 30 }, { filterType: 'bp' });
    return {
        id: 't',
        name: 'T',
        nodes: [{ id: 'in', factory: 'gain' }, pcf, { id: 'masterPcf', factory: 'masterPcf', fixed: true }],
        edges: [
            { from: 'in', to: pcf.id },
            { from: pcf.id, to: 'masterPcf' },
            { from: 'masterPcf', to: 'destination' },
        ],
    };
}

beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.stubGlobal(
        'AudioWorkletNode',
        class {
            port = { postMessage: vi.fn() };
            connect = vi.fn();
            disconnect = vi.fn();
        },
    );
});

afterEach(() => {
    disposeLivePcfInserts();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('PCF palette entry', () => {
    it('places a PCF with its knobs, type, mode and its own copy of the default pattern', () => {
        const empty: AudioGraphConfig = { id: 't', name: 'T', nodes: [], edges: [] };
        const a = createPaletteNode(empty, PCF, { cutoff: 999 }, { filterType: 'hp', filterMode: 'openrb' });
        expect(a).toMatchObject({ id: 'pcf-1', factory: 'pcf', label: 'PCF 1' });
        expect(a.config).toMatchObject({ enabled: true, cutoff: 127, filterType: 'hp', filterMode: 'openrb', followMasterLanes: false });
        expect((a.config as { pattern: number[] }).pattern).toEqual(PCF_NODE_DEFAULTS.pattern);
        const b = createPaletteNode(empty, PCF);
        expect((b.config as { pattern: number[] }).pattern).not.toBe((a.config as { pattern: number[] }).pattern);
    });
});

describe('compile', () => {
    it('wires a placed PCF through the host provider', () => {
        const patch = patchWithPcf();
        const graph = compileAudioGraph(fakeContext(), patch, { createPcfNode: createPcfNodeProvider() });
        const port = graph.getPort('pcf-1');
        expect(port.pcf).toBeDefined();
        expect(port.pcf!.knobs()).toMatchObject({ cutoff: 30, filterType: 'bp' });
        expect(graph.connectionLog.map((c) => [c.from, c.to])).toContainEqual(['in', 'pcf-1']);
    });

    it('bridges a placed PCF when the host supplies none', () => {
        const graph = compileAudioGraph(fakeContext(), patchWithPcf());
        expect(graph.nodes.has('pcf-1')).toBe(false);
        // The absent master PCF is bridged too.
        expect(graph.connectionLog.map((c) => [c.from, c.to])).toEqual([['in', 'destination']]);
    });

    it("hands the master PCF provider the node's filter mode", () => {
        const context = fakeContext();
        const effect = new PcfEffect(context);
        const patch = setPcfNodeConfig(CLASSIC_ELECTRIBE_GRAPH, 'masterPcf', { filterMode: 'openrb' }).config;
        const graph = compileAudioGraph(context, patch, {
            createMasterPcf: createMasterPcfProvider(effect),
            createReverbImpulse: () => ({}) as AudioBuffer,
        });
        const master = graph.getPort('masterPcf').pcf!;
        expect(master.master).toBe(true);
        expect(master.effect).toBe(effect);
        // No openrb module in tests: plays the pattern PCF and says why.
        expect(master.status()).toMatchObject({ mode: 'openrb', active: 'rbj', openrbAvailable: false });
    });
});

describe('setPcfNodeConfig', () => {
    it('stores every setting on a placed PCF, clamped', () => {
        const { config, rejected } = setPcfNodeConfig(patchWithPcf(), 'pcf-1', {
            cutoff: 500,
            pattern: [1, 2],
            followMasterLanes: true,
        });
        expect(rejected).toBeUndefined();
        expect(config.nodes.find((n) => n.id === 'pcf-1')?.config).toMatchObject({
            cutoff: 127,
            pattern: [1, 2],
            followMasterLanes: true,
            filterType: 'bp',
        });
    });

    it("stores only the master's filter mode: its knobs belong to the song", () => {
        const patch = patchWithPcf();
        expect(setPcfNodeConfig(patch, 'masterPcf', { cutoff: 10 }).config).toBe(patch);
        const { config } = setPcfNodeConfig(patch, 'masterPcf', { cutoff: 10, filterMode: 'openrb' });
        expect(config.nodes.find((n) => n.id === 'masterPcf')?.config).toEqual({ filterMode: 'openrb' });
    });

    it('refuses other nodes', () => {
        expect(setPcfNodeConfig(patchWithPcf(), 'in', { cutoff: 1 }).rejected?.code).toBe('not-pcf');
        expect(setPcfNodeConfig(patchWithPcf(), 'nope', { cutoff: 1 }).rejected?.code).toBe('unknown-node');
    });
});

describe('PatchController.setPcf', () => {
    function running() {
        const context = fakeContext();
        const effect = new PcfEffect(context);
        const controller = new PatchController(patchWithPcf());
        controller.compile(context, {
            createMasterPcf: createMasterPcfProvider(effect),
            createPcfNode: createPcfNodeProvider(),
        });
        return { controller, effect };
    }

    it('edits a running placed PCF live and saves it in the patch', () => {
        const { controller } = running();
        const outcome = controller.setPcf('pcf-1', { cutoff: 100, filterMode: 'openrb', followMasterLanes: true });
        expect(outcome.ok).toBe(true);
        expect(outcome.requiresRebuild).toBeUndefined();
        expect(outcome.pcf).toMatchObject({ live: true, knobs: { cutoff: 100 }, followMasterLanes: true });
        expect(controller.needsRebuild()).toBe(false);
        expect(controller.getConfig().nodes.find((n) => n.id === 'pcf-1')?.config).toMatchObject({
            cutoff: 100,
            filterMode: 'openrb',
            followMasterLanes: true,
        });
    });

    it('drives the running master PCF and marks it hand-edited, without touching the patch', () => {
        const { controller, effect } = running();
        const before = controller.getConfig();
        const listener = vi.fn();
        controller.subscribe(listener);
        listener.mockClear();
        const outcome = controller.setPcf('masterPcf', { enabled: true, cutoff: 12, pattern: [127, 0] });
        expect(outcome.ok).toBe(true);
        expect(effect.params).toMatchObject({ enabled: true, cutoff: 12 });
        expect(effect.pattern).toEqual([127, 0]);
        expect(effect.edited).toBe(true);
        expect(controller.getConfig()).toBe(before);
        // Subscribers still hear about it, so the panel re-renders.
        expect(listener).toHaveBeenCalled();
    });

    it("refuses the master's knobs when it is not running, but stages its mode", () => {
        const controller = new PatchController(patchWithPcf());
        expect(controller.setPcf('masterPcf', { cutoff: 12 }).ok).toBe(false);
        const staged = controller.setPcf('masterPcf', { filterMode: 'openrb' });
        expect(staged).toMatchObject({ ok: true, requiresRebuild: true });
        expect(controller.pcfState('masterPcf')).toMatchObject({ live: false, mode: { mode: 'openrb' } });
    });

    it('stages an edit to a PCF added since the engine started', () => {
        const controller = new PatchController(patchWithPcf());
        const outcome = controller.setPcf('pcf-1', { decay: 3 });
        expect(outcome).toMatchObject({ ok: true, requiresRebuild: true });
        expect(outcome.pcf).toMatchObject({ live: false, knobs: { decay: 3 }, reason: 'audio engine not running' });
    });

    it('reports state for PCF nodes only', () => {
        const { controller } = running();
        expect(controller.pcfState('pcf-1')).toMatchObject({ master: false, live: true });
        expect(controller.pcfState('masterPcf')).toMatchObject({ master: true, live: true });
        expect(controller.pcfState('in')).toBeNull();
    });
});

describe('persistence', () => {
    it('round-trips a placed PCF with its settings', () => {
        const patch = setPcfNodeConfig(patchWithPcf(), 'pcf-1', { pattern: [9, 8, 7], filterMode: 'openrb' }).config;
        const restored = deserializeAudioGraph(serializeAudioGraph(patch, true), 'classic').graph;
        const node = restored?.nodes.find((n) => n.id === 'pcf-1');
        expect(node).toMatchObject({ factory: 'pcf', config: { pattern: [9, 8, 7], filterMode: 'openrb' } });
    });
});
