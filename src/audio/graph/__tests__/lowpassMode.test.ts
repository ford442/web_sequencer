import { describe, expect, it } from 'vitest';

import {
    CLASSIC_ELECTRIBE_GRAPH,
    LowpassModeSwitch,
    NODE_PALETTE,
    PatchController,
    compileAudioGraph,
    createPaletteNode,
    isModalLowpass,
    normalizeLowpassMode,
    setLowpassMode,
    type AudioGraphConfig,
    type OpenrbLowpassBranch,
    type OpenrbLowpassProvider,
} from '../index';

interface FakeParam {
    value: number;
    setValueAtTime(value: number, time: number): void;
    linearRampToValueAtTime(value: number, time: number): void;
    cancelScheduledValues(time: number): void;
}

interface FakeNode {
    kind: string;
    outputs: FakeNode[];
    gain?: FakeParam;
    connect(dest: FakeNode): FakeNode;
    disconnect(): void;
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

function fakeContext() {
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
    const known: Record<string, unknown> = {
        currentTime: 0,
        sampleRate: 44_100,
        destination: make('destination'),
        createGain: () => make('gain', { gain: param(1) }),
        createBiquadFilter: () =>
            make('biquad', { type: 'lowpass', frequency: param(350), Q: param(1), gain: param(0) }),
        createStereoPanner: () => make('panner', { pan: param(0) }),
    };
    // Every other factory (the stock patch's compressors, delays, …) gets a node
    // whose AudioParams all exist.
    const generic = (kind: string) =>
        new Proxy(make(kind), {
            get: (target, key) =>
                key in target ? target[key as keyof FakeNode] : typeof key === 'string' ? param(0) : undefined,
            set: (target, key, value) => {
                (target as unknown as Record<string | symbol, unknown>)[key] = value;
                return true;
            },
        });
    return new Proxy(known, {
        get: (target, key) =>
            key in target
                ? target[key as string]
                : typeof key === 'string' && key.startsWith('create')
                  ? () => generic(key.slice(6))
                  : undefined,
    }) as unknown as BaseAudioContext;
}

/** A provider that hands out fake openrb branches and records the requests. */
function fakeProvider() {
    const requests: Array<{ nodeId: string; frequency: number; Q: number }> = [];
    const branches: Array<OpenrbLowpassBranch & { fail(reason: string): void }> = [];
    const provider: OpenrbLowpassProvider = (context, request) => {
        requests.push(request);
        let listener: ((reason: string) => void) | null = null;
        const node = (context as unknown as { createGain(): AudioNode }).createGain();
        const branch = {
            node,
            onUnavailable: (l: (reason: string) => void) => {
                listener = l;
            },
            bitExact: () => true,
            fail: (reason: string) => listener?.(reason),
        };
        branches.push(branch);
        return branch;
    };
    return { provider, requests, branches };
}

const LOWPASS = NODE_PALETTE.find((entry) => entry.label === 'Low-pass')!;

/** in → lp → destination, with `lp` from the palette. */
function patchWith(mode: 'rbj' | 'openrb'): AudioGraphConfig {
    const empty: AudioGraphConfig = { id: 't', name: 'T', nodes: [], edges: [] };
    const lp = createPaletteNode(empty, LOWPASS, { frequency: 800, Q: 4 }, { filterMode: mode });
    return {
        id: 't',
        name: 'T',
        nodes: [{ id: 'in', factory: 'gain' }, lp, { id: 'destination', factory: 'destination' }],
        edges: [
            { from: 'in', to: lp.id },
            { from: lp.id, to: 'destination' },
        ],
    };
}

const levels = (lp: LowpassModeSwitch) => {
    const rbjLevel = (lp.rbj as unknown as FakeNode).outputs[0];
    const openrbLevel = (lp.openrb?.node as unknown as FakeNode | undefined)?.outputs[0];
    return { rbj: rbjLevel.gain!.value, openrb: openrbLevel?.gain!.value };
};

describe('low-pass filter mode', () => {
    it('palette low-pass nodes carry a mode; other nodes do not take one', () => {
        expect(LOWPASS.choices?.[0]).toMatchObject({ key: 'filterMode', defaultValue: 'rbj' });
        const empty: AudioGraphConfig = { id: 't', name: 'T', nodes: [], edges: [] };
        const rbj = createPaletteNode(empty, LOWPASS);
        expect(rbj.config).toMatchObject({ type: 'lowpass', filterMode: 'rbj' });
        const bogus = createPaletteNode(empty, LOWPASS, {}, { filterMode: 'moog' });
        expect(bogus.config).toMatchObject({ filterMode: 'rbj' });
        expect(isModalLowpass(rbj)).toBe(true);
        const highpass = createPaletteNode(empty, NODE_PALETTE.find((e) => e.label === 'High-pass')!);
        expect(isModalLowpass(highpass)).toBe(false);
        // An older user low-pass without a mode still gets the switch …
        expect(isModalLowpass({ factory: 'biquadFilter', config: { type: 'lowpass' } })).toBe(true);
        // … but fixed preset filters without one stay plain biquads.
        expect(isModalLowpass({ factory: 'biquadFilter', fixed: true, config: { type: 'lowpass' } })).toBe(false);
        expect(CLASSIC_ELECTRIBE_GRAPH.nodes.some(isModalLowpass)).toBe(false);
        expect(normalizeLowpassMode('openrb')).toBe('openrb');
        expect(normalizeLowpassMode(42)).toBe('rbj');
    });

    it('compiles both branches behind a switch and A/Bs them live', () => {
        const { provider, requests } = fakeProvider();
        const graph = compileAudioGraph(fakeContext(), patchWith('openrb'), { createOpenrbLowpass: provider });
        expect(requests).toEqual([{ nodeId: 'biquadFilter-1', frequency: 800, Q: 4 }]);
        const lp = graph.getPort('biquadFilter-1').lowpass!;
        expect(lp).toBeInstanceOf(LowpassModeSwitch);
        expect(lp.status()).toEqual({
            mode: 'openrb',
            active: 'openrb',
            openrbAvailable: true,
            bitExact: true,
        });
        expect(levels(lp)).toEqual({ rbj: 0, openrb: 1 });
        // The upstream cable lands on the switch input, which feeds both filters.
        const input = lp.input as unknown as FakeNode;
        expect(input.outputs.map((n) => n.kind)).toEqual(['biquad', 'gain']);

        expect(lp.setMode('rbj').active).toBe('rbj');
        expect(levels(lp)).toEqual({ rbj: 1, openrb: 0 });
        lp.setMode('openrb');
        expect(levels(lp)).toEqual({ rbj: 0, openrb: 1 });
    });

    it('plays RBJ in every mode when openrb is not available, and says why', () => {
        const graph = compileAudioGraph(fakeContext(), patchWith('openrb'));
        const lp = graph.getPort('biquadFilter-1').lowpass!;
        expect(lp.openrb).toBeNull();
        const status = lp.status();
        expect(status).toMatchObject({ mode: 'openrb', active: 'rbj', openrbAvailable: false });
        expect(status.reason).toMatch(/openrb338\.wasm/);
        expect(levels(lp).rbj).toBe(1);
    });

    it('falls back to RBJ when the branch reports it cannot run', () => {
        const { provider, branches } = fakeProvider();
        const graph = compileAudioGraph(fakeContext(), patchWith('openrb'), { createOpenrbLowpass: provider });
        const lp = graph.getPort('biquadFilter-1').lowpass!;
        branches[0].fail('module rejected');
        expect(lp.status()).toMatchObject({ active: 'rbj', openrbAvailable: false, reason: 'module rejected' });
        expect(levels(lp)).toEqual({ rbj: 1, openrb: 0 });
    });

    it('setLowpassMode edits the config and refuses nodes without a mode', () => {
        const config = patchWith('rbj');
        const next = setLowpassMode(config, 'biquadFilter-1', 'openrb');
        expect(next.rejected).toBeUndefined();
        expect(next.config.nodes[1].config).toMatchObject({ type: 'lowpass', frequency: 800, filterMode: 'openrb' });
        expect(config.nodes[1].config).toMatchObject({ filterMode: 'rbj' }); // not mutated
        expect(setLowpassMode(config, 'in', 'openrb').rejected?.code).toBe('not-lowpass');
        expect(setLowpassMode(config, 'nope', 'openrb').rejected?.code).toBe('unknown-node');
        expect(setLowpassMode(CLASSIC_ELECTRIBE_GRAPH, 'bassSidechainEQ', 'openrb').rejected?.code).toBe('not-lowpass');
    });

    it('PatchController switches a running node live and stages one added since', () => {
        const { provider } = fakeProvider();
        const controller = new PatchController(patchWith('rbj'));
        controller.compile(fakeContext() as AudioContext, { createOpenrbLowpass: provider, validate: false });
        const live = controller.setLowpassMode('biquadFilter-1', 'openrb');
        expect(live).toMatchObject({ ok: true, lowpass: { mode: 'openrb', active: 'openrb' } });
        expect(live.requiresRebuild).toBeUndefined();
        expect(controller.needsRebuild()).toBe(false);
        expect(controller.lowpassStatus('biquadFilter-1')?.active).toBe('openrb');
        expect(controller.lowpassStatus('in')).toBeNull();
        expect((controller.getConfig().nodes[1].config as { filterMode?: string }).filterMode).toBe('openrb');

        const added = createPaletteNode(controller.getConfig(), LOWPASS);
        controller.addNode(added);
        const staged = controller.setLowpassMode(added.id, 'openrb');
        expect(staged).toMatchObject({ ok: true, requiresRebuild: true, lowpass: { mode: 'openrb', active: 'rbj' } });
        expect(controller.setLowpassMode('in', 'openrb').ok).toBe(false);
    });
});
