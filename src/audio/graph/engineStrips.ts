/**
 * The engine layer of the stock patch: where each first-party engine enters
 * the graph, and the per-voice strips that used to be private mixers.
 *
 * Before Phase C, `Open303Manager` built a gain / drive `WaveShaper` / panner
 * chain per voice that the patch bay could not see, and every other engine
 * connected straight into a hard-coded bus. Those chains are now ordinary graph
 * nodes built from the existing factories, so the patch owns them and a WAM2
 * insert can be cabled in anywhere along them. Playback resolves the strip
 * nodes by the ids below (they are `fixed`, like `masterGain`) and the engine
 * sockets by factory + voice.
 *
 * The topology is the pre-Phase-C one, node for node:
 *
 *   303 voice ─┬─ dry (1) ──────────────┬─ gain ─ pan ─ masterSaturation
 *              └─ wet (0) ─ drive (100) ┘
 *   Prophecy A/B → Synth A/B bus · drum kit → masterGain
 *   sustain → masterGain · Rubber Band voices → sampler bus
 *   choir L/R panners → choir sum → masterGain
 */

import { isEngineVoiceFactory } from './engineVoices';
import type { AudioGraphConfig, GraphEdgeSpec, GraphNodeSpec } from './types';

export type Open303VoiceId = 'lead303' | 'bass1' | 'bass2';

export const OPEN303_VOICES: readonly Open303VoiceId[] = ['lead303', 'bass1', 'bass2'];

export type ProphecyVoiceId = 'partA' | 'partB';

/** `samplerVoice` instances: the one-shot sustain worklet and the Rubber Band voice pool. */
export type SamplerVoiceId = 'sustain' | 'stretch';

/** Node ids of one 303 voice's strip in the stock patch. */
export interface Open303StripIds {
    voice: string;
    dry: string;
    wet: string;
    drive: string;
    gain: string;
    pan: string;
}

export function open303StripIds(voice: Open303VoiceId): Open303StripIds {
    return {
        voice: `${voice}Voice`,
        dry: `${voice}DriveDry`,
        wet: `${voice}DriveWet`,
        drive: `${voice}Drive`,
        gain: `${voice}Gain`,
        pan: `${voice}Pan`,
    };
}

/** Engine-layer edge. `replaces` is the pre-Phase-C edge this one supersedes. */
interface EngineLayerEdge extends GraphEdgeSpec {
    replaces?: { from: string; to: string };
}

const OPEN303_STRIP_DEFAULTS: Record<Open303VoiceId, { label: string; pan: number }> = {
    lead303: { label: '303 Lead', pan: 0 },
    bass1: { label: '303 Bass', pan: -0.2 },
    bass2: { label: '303 Bass 2', pan: 0.2 },
};

function open303Strip(voice: Open303VoiceId): { nodes: GraphNodeSpec[]; edges: EngineLayerEdge[] } {
    const ids = open303StripIds(voice);
    const { label, pan } = OPEN303_STRIP_DEFAULTS[voice];
    return {
        nodes: [
            {
                id: ids.voice,
                label,
                fixed: true,
                factory: 'open303Voice',
                role: 'instrumentSource',
                config: { voice },
            },
            { id: ids.dry, label: `${label} Dry`, fixed: true, factory: 'gain', config: { gain: 1 } },
            { id: ids.wet, label: `${label} Drive Send`, fixed: true, factory: 'gain', config: { gain: 0 } },
            {
                // Fixed curve; the drive amount is the dry/wet crossfade above.
                id: ids.drive,
                label: `${label} Drive`,
                fixed: true,
                factory: 'waveShaper',
                config: { drive: 100, oversample: 'none' },
            },
            { id: ids.gain, label: `${label} Level`, fixed: true, factory: 'gain', config: { gain: 1 } },
            { id: ids.pan, label: `${label} Pan`, fixed: true, factory: 'stereoPanner', config: { pan } },
        ],
        edges: [
            { from: ids.voice, to: ids.dry },
            { from: ids.voice, to: ids.wet },
            { from: ids.wet, to: ids.drive },
            { from: ids.dry, to: ids.gain },
            { from: ids.drive, to: ids.gain },
            { from: ids.gain, to: ids.pan },
            { from: ids.pan, to: 'masterSaturation' },
        ],
    };
}

const strips = OPEN303_VOICES.map(open303Strip);

const ENGINE_LAYER_NODES: readonly GraphNodeSpec[] = [
    ...strips.flatMap((strip) => strip.nodes),
    {
        id: 'prophecyA',
        label: 'Prophecy A',
        fixed: true,
        factory: 'prophecyVoice',
        role: 'instrumentSource',
        config: { voice: 'partA' },
    },
    {
        id: 'prophecyB',
        label: 'Prophecy B',
        fixed: true,
        factory: 'prophecyVoice',
        role: 'instrumentSource',
        config: { voice: 'partB' },
    },
    { id: 'drumkit', label: 'Drum Kit', fixed: true, factory: 'drumkitVoice', role: 'instrumentSource' },
    {
        id: 'samplerSustain',
        label: 'Sustain',
        fixed: true,
        factory: 'samplerVoice',
        role: 'instrumentSource',
        config: { voice: 'sustain' },
    },
    {
        id: 'samplerStretch',
        label: 'Sampler Voices',
        fixed: true,
        factory: 'samplerVoice',
        role: 'instrumentSource',
        config: { voice: 'stretch' },
    },
    { id: 'choirSum', label: 'Choir Sum', fixed: true, factory: 'harmonizerBus', role: 'choirBus' },
];

const ENGINE_LAYER_EDGES: readonly EngineLayerEdge[] = [
    ...strips.flatMap((strip) => strip.edges),
    { from: 'prophecyA', to: 'synthABus' },
    { from: 'prophecyB', to: 'synthBBus' },
    // Drums, sustain and the choir bypass the master FX chain, as they always have.
    { from: 'drumkit', to: 'masterGain' },
    { from: 'samplerSustain', to: 'masterGain' },
    { from: 'samplerStretch', to: 'samplerBus' },
    {
        from: 'choirLeftPanner',
        to: 'choirSum',
        replaces: { from: 'choirLeftPanner', to: 'masterGain' },
    },
    {
        from: 'choirRightPanner',
        to: 'choirSum',
        replaces: { from: 'choirRightPanner', to: 'masterGain' },
    },
    { from: 'choirSum', to: 'masterGain' },
];

/** Engine-layer nodes, for the stock patch. */
export function engineLayerNodes(): GraphNodeSpec[] {
    return ENGINE_LAYER_NODES.map((node) => ({
        ...node,
        ...(node.config ? { config: { ...node.config } } : {}),
    }));
}

/** Engine-layer edges, for the stock patch. */
export function engineLayerEdges(): GraphEdgeSpec[] {
    return ENGINE_LAYER_EDGES.map(({ from, to }) => ({ from, to }));
}

function voiceKey(node: Pick<GraphNodeSpec, 'factory' | 'config'>): string {
    const voice = (node.config as { voice?: unknown } | undefined)?.voice;
    return `${node.factory}:${typeof voice === 'string' ? voice : ''}`;
}

/**
 * Upgrade a patch saved before Phase C so its engines have somewhere to attach.
 *
 * Adds each missing engine node (unless the patch already carries the same
 * engine voice under another id) and the edges that wire it in, retiring the
 * direct edge each new edge `replaces` so the choir is not summed twice. Never
 * touches an edge the user made between existing nodes. Returns the input
 * object unchanged when nothing was missing.
 */
export function withEngineVoices(config: AudioGraphConfig): AudioGraphConfig {
    const ids = new Set(config.nodes.map((node) => node.id));
    const voices = new Set(config.nodes.map(voiceKey));
    const added = new Set<string>();
    const nodes = [...config.nodes];

    for (const node of ENGINE_LAYER_NODES) {
        if (ids.has(node.id)) continue;
        if (isEngineVoiceFactory(node.factory) && voices.has(voiceKey(node))) continue;
        nodes.push({ ...node, ...(node.config ? { config: { ...node.config } } : {}) });
        ids.add(node.id);
        added.add(node.id);
    }
    if (added.size === 0) return config;

    let edges = [...config.edges];
    for (const edge of ENGINE_LAYER_EDGES) {
        if (!added.has(edge.from) && !added.has(edge.to)) continue;
        if (!ids.has(edge.from) || !ids.has(edge.to)) continue;
        const { replaces } = edge;
        if (replaces) {
            edges = edges.filter((e) => !(e.from === replaces.from && e.to === replaces.to));
        }
        edges.push({ from: edge.from, to: edge.to });
    }

    return { ...config, nodes, edges };
}
