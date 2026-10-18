import { describe, expect, it, vi } from 'vitest';
import { compileAudioGraph } from '../compileGraph';
import { CLASSIC_ELECTRIBE_GRAPH } from '../defaultElectribeGraph';
import { EngineVoiceSocket, findEngineVoice, listEngineVoices } from '../engineVoices';
import { engineLayerEdges, open303StripIds, withEngineVoices } from '../engineStrips';
import { addConnection, validateGraph } from '../graphOps';
import { deserializeAudioGraph, serializeAudioGraph } from '../graphSerialization';
import { GRAPH_PRESETS, buildPreset } from '../presets';
import { restorePatchFromSong } from '../patchSession';
import { getActivePatchController, setActivePatchController } from '../patchRegistry';
import type { AudioGraphConfig } from '../types';
import { applyWamSlotsToGraph } from '../../wam/applySlots';
import { Open303Manager } from '../../../engines/Open303Manager';
import { ProphecyManager } from '../../../engines/ProphecyManager';

interface FakeNode {
    label: string;
    connect: (dest: FakeNode) => void;
    disconnect: () => void;
}

/**
 * Context whose nodes are all distinct and remember their wiring and the last
 * value scheduled on each AudioParam — enough to follow audio from an engine
 * socket to the destination without a real audio thread.
 */
function fakeContext() {
    let counter = 0;
    const wires: Array<[string, string]> = [];
    const param = (value: number) => ({
        value,
        setValueAtTime(next: number) {
            this.value = next;
        },
        linearRampToValueAtTime(next: number) {
            this.value = next;
        },
    });
    const make = (kind: string, extra: Record<string, unknown> = {}): FakeNode => {
        const node: FakeNode = {
            label: `${kind}#${counter++}`,
            connect: (dest) => wires.push([node.label, dest.label]),
            disconnect: () => {},
            ...extra,
        };
        return node;
    };
    const context = {
        currentTime: 0,
        sampleRate: 48000,
        destination: make('destination'),
        createGain: () => make('gain', { gain: param(1) }),
        createWaveShaper: () => make('shaper', { curve: null, oversample: 'none' }),
        createBiquadFilter: () =>
            make('biquad', { type: 'lowpass', frequency: param(0), Q: param(0), gain: param(0) }),
        createDynamicsCompressor: () =>
            make('comp', {
                threshold: param(0),
                knee: param(0),
                ratio: param(0),
                attack: param(0),
                release: param(0),
            }),
        createStereoPanner: () => make('panner', { pan: param(0) }),
        createAnalyser: () => make('analyser', { fftSize: 256, smoothingTimeConstant: 0.5 }),
        createConvolver: () => make('convolver', { buffer: null }),
        createDelay: () => make('delay', { delayTime: param(0) }),
        createBuffer: (channels: number, length: number, sampleRate: number) => ({
            numberOfChannels: channels,
            length,
            sampleRate,
            getChannelData: () => new Float32Array(length),
        }),
    };
    return { context: context as unknown as AudioContext, wires };
}

const impulse = () => ({}) as AudioBuffer;

function compileClassic(config: AudioGraphConfig = CLASSIC_ELECTRIBE_GRAPH) {
    const { context, wires } = fakeContext();
    const graph = compileAudioGraph(context, config, { createReverbImpulse: impulse });
    return { context, wires, graph };
}

/** Graph-level reachability over the compile log (edge order is the wiring order). */
function reaches(log: ReadonlyArray<{ from: string; to: string }>, from: string, to: string): boolean {
    const seen = new Set<string>([from]);
    const queue = [from];
    while (queue.length > 0) {
        const id = queue.shift()!;
        if (id === to) return true;
        for (const edge of log) {
            if (edge.from === id && !seen.has(edge.to)) {
                seen.add(edge.to);
                queue.push(edge.to);
            }
        }
    }
    return false;
}

/** The stock patch as it was stored before Phase C: no engine layer, choir straight to masterGain. */
function prePhaseCGraph(): AudioGraphConfig {
    const kept = (id: string) => CLASSIC_PRE_C_NODE_IDS.has(id);
    return {
        id: 'classic-electribe',
        name: 'Classic Electribe',
        presetId: 'classic-electribe',
        nodes: CLASSIC_ELECTRIBE_GRAPH.nodes.filter((node) => kept(node.id)),
        edges: [
            ...CLASSIC_ELECTRIBE_GRAPH.edges.filter((e) => kept(e.from) && kept(e.to)),
            { from: 'choirLeftPanner', to: 'masterGain' },
            { from: 'choirRightPanner', to: 'masterGain' },
            // A user send made before the upgrade must survive it.
            { from: 'synthABus', to: 'reverbHall', gain: 0.4 },
        ],
    };
}

const CLASSIC_PRE_C_NODE_IDS = new Set([
    'masterSaturation', 'bassSidechainEQ', 'sidechainGain', 'masterCompressor', 'masterGain',
    'masterPanner', 'masterLimiter', 'destination', 'masterAnalyser', 'synthABus', 'synthBBus',
    'samplerBus', 'reverbRoom', 'reverbPlate', 'reverbHall', 'delay', 'delayFeedback',
    'choirLeftGain', 'choirLeftPanner', 'choirRightGain', 'choirRightPanner',
]);

describe('engine voice factories', () => {
    it('compiles every first-party engine to a dual-port socket', () => {
        const { graph } = compileClassic();
        const sockets = listEngineVoices(graph).map((s) => `${s.factory}:${s.voice ?? '-'}`);
        expect(sockets.sort()).toEqual([
            'drumkitVoice:-',
            'harmonizerBus:-',
            'open303Voice:bass1',
            'open303Voice:bass2',
            'open303Voice:lead303',
            'prophecyVoice:partA',
            'prophecyVoice:partB',
            'samplerVoice:stretch',
            'samplerVoice:sustain',
        ]);
        for (const socket of listEngineVoices(graph)) {
            const port = graph.getPort(socket.nodeId);
            expect(port.engineSocket).toBe(socket);
            expect(port.input).not.toBe(port.output);
            // The node map holds the output, like a WAM2 slot.
            expect(graph.getNode(socket.nodeId)).toBe(port.output);
        }
        expect(graph.getRoleNodes('instrumentSource')).toHaveLength(8);
    });

    it('wires a socket input through to its output so cables into an engine node sum', () => {
        const { context, wires } = fakeContext();
        const socket = new EngineVoiceSocket(context, 'choirSum', 'harmonizerBus', null);
        const input = socket.input as unknown as FakeNode;
        const output = socket.output as unknown as FakeNode;
        expect(wires).toContainEqual([input.label, output.label]);

        const engine = { connect: vi.fn() };
        socket.attach(engine);
        socket.attach(engine);
        expect(engine.connect).toHaveBeenCalledOnce();
        expect(engine.connect).toHaveBeenCalledWith(socket.output);
        expect(socket.isAttached).toBe(true);
    });

    it('takes sockets from the injected provider and bridges the ones it declines', () => {
        const { context } = fakeContext();
        const requests: string[] = [];
        const graph = compileAudioGraph(context, CLASSIC_ELECTRIBE_GRAPH, {
            createReverbImpulse: impulse,
            createEngineVoice: (ctx, request) => {
                requests.push(`${request.nodeId}:${request.factory}:${request.voice ?? '-'}`);
                // Offline-style: no drum kit, and the choir sum collapses to a wire.
                if (request.factory === 'drumkitVoice' || request.factory === 'harmonizerBus') return null;
                return new EngineVoiceSocket(ctx, request.nodeId, request.factory, request.voice);
            },
        });

        expect(requests).toContain('bass1Voice:open303Voice:bass1');
        expect(requests).toContain('drumkit:drumkitVoice:-');
        expect(graph.nodes.has('drumkit')).toBe(false);
        expect(graph.nodes.has('choirSum')).toBe(false);
        const pairs = graph.connectionLog.map((c) => `${c.from}->${c.to}`);
        expect(pairs).toContain('choirLeftPanner->masterGain');
        expect(pairs).toContain('choirRightPanner->masterGain');
        expect(pairs.some((p) => p.startsWith('drumkit->'))).toBe(false);
    });

    it('routes each 303 voice through its patch strip into the master FX input', () => {
        const { graph } = compileClassic();
        for (const voice of ['lead303', 'bass1', 'bass2'] as const) {
            const ids = open303StripIds(voice);
            const pairs = graph.connectionLog.map((c) => `${c.from}->${c.to}`);
            expect(pairs).toEqual(
                expect.arrayContaining([
                    `${ids.voice}->${ids.dry}`,
                    `${ids.voice}->${ids.wet}`,
                    `${ids.wet}->${ids.drive}`,
                    `${ids.dry}->${ids.gain}`,
                    `${ids.drive}->${ids.gain}`,
                    `${ids.gain}->${ids.pan}`,
                    `${ids.pan}->masterSaturation`,
                ]),
            );
        }
    });

    it('bridges the strip panner when the context has no StereoPanner', () => {
        const { context } = fakeContext();
        const graph = compileAudioGraph(context, CLASSIC_ELECTRIBE_GRAPH, {
            createReverbImpulse: impulse,
            useStereoPanner: false,
        });
        const pairs = graph.connectionLog.map((c) => `${c.from}->${c.to}`);
        expect(pairs).toContain('bass1Gain->masterSaturation');
        expect(pairs).toContain('choirLeftGain->choirSum');
        expect(pairs.some((p) => p.includes('Pan'))).toBe(false);
    });
});

describe('WAM2 inserts on first-party engines', () => {
    it('cables a WAM2 track insert after an open303Voice without touching playback', () => {
        const patched = applyWamSlotsToGraph(CLASSIC_ELECTRIBE_GRAPH, [
            {
                slotId: 'wam-bass1-insert',
                packageId: 'hyphon.tone',
                placement: 'trackInsert',
                attachToNodeId: 'masterSaturation',
                interceptFromNodeId: 'bass1Pan',
            } as never,
        ]);
        const { graph } = compileClassic(patched);
        const log = graph.connectionLog;
        const pairs = log.map((c) => `${c.from}->${c.to}`);
        expect(pairs).toContain('bass1Pan->wam-bass1-insert');
        expect(pairs).toContain('wam-bass1-insert->masterSaturation');
        expect(pairs).not.toContain('bass1Pan->masterSaturation');
        expect(reaches(log, 'bass1Voice', 'wam-bass1-insert')).toBe(true);
        // The other voices are untouched.
        expect(pairs).toContain('lead303Pan->masterSaturation');
    });

    it('cables a WAM2 track insert onto the sampler voices', () => {
        const patched = applyWamSlotsToGraph(CLASSIC_ELECTRIBE_GRAPH, [
            {
                slotId: 'wam-sampler-insert',
                packageId: 'hyphon.tone',
                placement: 'trackInsert',
                attachToNodeId: 'samplerBus',
                interceptFromNodeId: 'samplerStretch',
            } as never,
        ]);
        const { graph } = compileClassic(patched);
        const pairs = graph.connectionLog.map((c) => `${c.from}->${c.to}`);
        expect(pairs).toContain('samplerStretch->wam-sampler-insert');
        expect(pairs).toContain('wam-sampler-insert->samplerBus');
    });

    it('still accepts the classic delay feedback and still refuses a loop through an engine node', () => {
        expect(validateGraph(CLASSIC_ELECTRIBE_GRAPH).valid).toBe(true);
        expect(() => compileClassic()).not.toThrow();
        const loop = addConnection(CLASSIC_ELECTRIBE_GRAPH, 'choirSum', 'choirLeftGain');
        expect(loop.rejected?.code).toBe('cycle');
    });
});

describe('Open303Manager as a handle registry', () => {
    function managerWithFakeVoices() {
        const manager = new Open303Manager();
        const voices = {
            bass1: { connect: vi.fn(), disconnect: vi.fn(), setParam: vi.fn() },
            bass2: { connect: vi.fn(), disconnect: vi.fn(), setParam: vi.fn() },
            lead303: { connect: vi.fn(), disconnect: vi.fn(), setParam: vi.fn() },
        };
        const internals = manager as unknown as Record<string, unknown>;
        Object.assign(internals, voices, {
            bass1Ready: true,
            bass2Ready: true,
            lead303Ready: true,
            isReady: true,
        });
        return { manager, voices };
    }

    it('plugs each voice into its socket and rides the patch strip, not a private mixer', () => {
        const { graph, context } = compileClassic();
        const { manager, voices } = managerWithFakeVoices();
        (manager as unknown as { audioContext: AudioContext }).audioContext = context;

        expect(manager.attachToGraph(graph)).toEqual([]);
        expect(voices.bass1.connect).toHaveBeenCalledWith(findEngineVoice(graph, 'open303Voice', 'bass1')!.output);
        expect(voices.bass2.connect).toHaveBeenCalledWith(findEngineVoice(graph, 'open303Voice', 'bass2')!.output);

        const level = (id: string) => (graph.getNode(id) as GainNode).gain.value;
        manager.setBass1Volume(0.3);
        expect(level('bass1Gain')).toBeCloseTo(0.3);
        expect(level('bass2Gain')).toBe(1);

        manager.setBass2Drive(0.75);
        expect(level('bass2DriveWet')).toBeCloseTo(0.75);
        expect(level('bass2DriveDry')).toBeCloseTo(0.25);

        manager.scheduleParamAtTime('lead303', 'setPan', -0.5, 0);
        expect((graph.getNode('lead303Pan') as StereoPannerNode).pan.value).toBeCloseTo(-0.5);

        manager.setLead303Mute(true);
        expect(level('lead303Gain')).toBe(0);
    });

    it('falls back to a direct route, loudly, when the patch has no node for a voice', () => {
        const { context } = fakeContext();
        const bare = compileAudioGraph(
            context,
            {
                id: 'bare',
                name: 'Bare',
                nodes: [{ id: 'masterGain', factory: 'gain' }, { id: 'destination', factory: 'destination' }],
                edges: [{ from: 'masterGain', to: 'destination' }],
            },
        );
        const { manager, voices } = managerWithFakeVoices();
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const fallback = bare.getNode('masterGain');
        expect(manager.attachToGraph(bare, fallback).sort()).toEqual(['bass1', 'bass2', 'lead303']);
        expect(voices.bass1.connect).toHaveBeenCalledWith(fallback);
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
    });

    it('attaches Prophecy parts to their prophecyVoice nodes', () => {
        const { graph } = compileClassic();
        const manager = new ProphecyManager();
        const partA = { connect: vi.fn() };
        const partB = { connect: vi.fn() };
        Object.assign(manager as unknown as Record<string, unknown>, { partA, partB });
        expect(manager.attachToGraph(graph)).toEqual([]);
        expect(partA.connect).toHaveBeenCalledWith(findEngineVoice(graph, 'prophecyVoice', 'partA')!.output);
        expect(partB.connect).toHaveBeenCalledWith(findEngineVoice(graph, 'prophecyVoice', 'partB')!.output);
    });
});

describe('patches saved before Phase C', () => {
    it('gain the engine layer on load, with the choir rerouted rather than doubled', () => {
        const old = prePhaseCGraph();
        expect(validateGraph(old).valid).toBe(true);
        const upgraded = withEngineVoices(old);

        for (const node of CLASSIC_ELECTRIBE_GRAPH.nodes) {
            expect(upgraded.nodes.some((n) => n.id === node.id)).toBe(true);
        }
        const pairs = upgraded.edges.map((e) => `${e.from}->${e.to}`);
        expect(pairs).not.toContain('choirLeftPanner->masterGain');
        expect(pairs).toContain('choirLeftPanner->choirSum');
        for (const edge of engineLayerEdges()) expect(pairs).toContain(`${edge.from}->${edge.to}`);
        expect(upgraded.edges).toContainEqual({ from: 'synthABus', to: 'reverbHall', gain: 0.4 });
        expect(validateGraph(upgraded).valid).toBe(true);
    });

    it('a song with no audioGraph still loads Classic Electribe, engines included', () => {
        setActivePatchController(null);
        try {
            const restored = restorePatchFromSong(undefined);
            expect(restored.fellBack).toBe(false);
            expect(restored.config.presetId).toBe('classic-electribe');
            const { graph } = compileClassic(restored.config);
            expect(listEngineVoices(graph)).toHaveLength(9);
            expect(getActivePatchController()?.isModified()).toBe(false);
        } finally {
            setActivePatchController(null);
        }
    });

    it('is idempotent, and a no-op on a current patch', () => {
        const upgraded = withEngineVoices(prePhaseCGraph());
        expect(withEngineVoices(upgraded)).toBe(upgraded);
        expect(withEngineVoices(CLASSIC_ELECTRIBE_GRAPH)).toBe(CLASSIC_ELECTRIBE_GRAPH);
    });

    it('upgrades through song deserialization', () => {
        const stored = serializeAudioGraph(prePhaseCGraph(), true);
        const { graph } = deserializeAudioGraph(JSON.parse(JSON.stringify(stored)), 'classic-electribe');
        expect(graph).not.toBeNull();
        expect(graph!.nodes.some((n) => n.factory === 'open303Voice')).toBe(true);
        expect(() => compileClassic(graph!)).not.toThrow();
    });

    it('round-trips a current patch with engine nodes through the song payload', () => {
        const edited = addConnection(CLASSIC_ELECTRIBE_GRAPH, 'bass1Pan', 'reverbPlate', { gain: 0.2 });
        const stored = serializeAudioGraph(edited.config, true);
        const { graph } = deserializeAudioGraph(JSON.parse(JSON.stringify(stored)), 'classic-electribe');
        expect(graph).toEqual(edited.config);
    });
});

describe('presets', () => {
    it('every preset validates and compiles with its engines in place', () => {
        for (const preset of GRAPH_PRESETS) {
            const config = preset.build();
            expect(validateGraph(config).valid).toBe(true);
            const { graph } = compileClassic(config);
            expect(listEngineVoices(graph)).toHaveLength(9);
        }
    });

    it('Vocal Workstation puts the sampler voices and choir in front of a vocal compressor and sends', () => {
        const config = buildPreset('vocal-workstation');
        expect(config.presetId).toBe('vocal-workstation');
        const { graph } = compileClassic(config);
        const log = graph.connectionLog;
        const pairs = log.map((c) => `${c.from}->${c.to}`);
        expect(pairs).toContain('samplerBus->vocalCompressor');
        expect(pairs).not.toContain('samplerBus->masterSaturation');
        expect(reaches(log, 'samplerStretch', 'vocalCompressor')).toBe(true);
        expect(reaches(log, 'samplerStretch', 'reverbPlate')).toBe(true);
        expect(reaches(log, 'choirSum', 'reverbPlate')).toBe(true);
        expect(graph.sendGains.has('vocalCompressor→reverbPlate')).toBe(true);
    });
});
