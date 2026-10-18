/**
 * Graph preset registry.
 *
 * A preset is just an `AudioGraphConfig`, so presets and user patches are the
 * same kind of object — loading a preset is `replaceConfig`, and saving a patch
 * records which preset it came from. Classic Electribe stays the default and is
 * the literal `CLASSIC_ELECTRIBE_GRAPH`, so the stock routing is unchanged by
 * construction rather than by copying.
 */

import { CLASSIC_ELECTRIBE_GRAPH } from './defaultElectribeGraph';
import { addConnection, addNode, removeConnection, setConnectionGain } from './graphOps';
import type { AudioGraphConfig } from './types';

export interface GraphPreset {
    id: string;
    name: string;
    description: string;
    build: () => AudioGraphConfig;
}

/** Deep-ish clone so a preset can be edited without touching the registry. */
function clone(config: AudioGraphConfig, id: string, name: string): AudioGraphConfig {
    return {
        ...config,
        id,
        name,
        presetId: id,
        nodes: config.nodes.map((node) => ({ ...node })),
        edges: config.edges.map((edge) => ({ ...edge })),
    };
}

/**
 * Dual 303 + Sidechain: both synth buses feed the plate return, and the
 * sidechain shelf is pre-wired so a kick-driven duck has somewhere to land.
 * Built by *editing* the classic graph, which doubles as a demonstration that
 * the ops in `graphOps` are enough to author a preset.
 */
function buildDual303(): AudioGraphConfig {
    let config = clone(CLASSIC_ELECTRIBE_GRAPH, 'dual-303-sidechain', 'Dual 303 + Sidechain');
    config = setConnectionGain(config, 'synthABus', 'masterSaturation', 1);

    const withSendA = addConnection(config, 'synthABus', 'reverbPlate', { gain: 0.25 });
    if (withSendA.config) config = withSendA.config;
    const withSendB = addConnection(config, 'synthBBus', 'reverbPlate', { gain: 0.18 });
    if (withSendB.config) config = withSendB.config;
    const withDelay = addConnection(config, 'synthABus', 'delay', { gain: 0.2 });
    if (withDelay.config) config = withDelay.config;

    return config;
}

/** Apply an edit that the preset author knows is valid; a refusal is a bug in the preset. */
function must(result: { config: AudioGraphConfig; rejected?: { message: string } }): AudioGraphConfig {
    if (result.rejected) throw new Error(`Preset edit refused: ${result.rejected.message}`);
    return result.config;
}

/**
 * Vocal Workstation: the sampler (Rubber Band voices + sustain) gets its own
 * vocal compressor before the master FX chain, and both the sampler bus and the
 * choir sum feed the plate and the delay. Only meaningful now that the sampler
 * voices and the choir sum are graph nodes (Phase C).
 */
function buildVocalWorkstation(): AudioGraphConfig {
    let config = clone(CLASSIC_ELECTRIBE_GRAPH, 'vocal-workstation', 'Vocal Workstation');
    config = must(
        addNode(config, {
            id: 'vocalCompressor',
            label: 'Vocal Comp',
            fixed: true,
            factory: 'dynamicsCompressor',
            config: { threshold: -22, knee: 12, ratio: 3, attack: 0.008, release: 0.18 },
        }),
    );
    config = removeConnection(config, 'samplerBus', 'masterSaturation');
    config = must(addConnection(config, 'samplerBus', 'vocalCompressor'));
    config = must(addConnection(config, 'vocalCompressor', 'masterSaturation'));
    config = must(addConnection(config, 'vocalCompressor', 'reverbPlate', { gain: 0.3 }));
    config = must(addConnection(config, 'vocalCompressor', 'delay', { gain: 0.15 }));
    config = must(addConnection(config, 'choirSum', 'reverbPlate', { gain: 0.35 }));
    return config;
}

export const GRAPH_PRESETS: readonly GraphPreset[] = [
    {
        id: 'classic-electribe',
        name: 'Classic Electribe',
        description: 'Stock routing: master FX chain, dry input, aux returns.',
        build: () => clone(CLASSIC_ELECTRIBE_GRAPH, 'classic-electribe', 'Classic Electribe'),
    },
    {
        id: 'dual-303-sidechain',
        name: 'Dual 303 + Sidechain',
        description: 'Both 303 buses sent to plate and delay, sidechain shelf armed.',
        build: buildDual303,
    },
    {
        id: 'vocal-workstation',
        name: 'Vocal Workstation',
        description: 'Sampler voices through a vocal compressor; sampler and choir sent to plate and delay.',
        build: buildVocalWorkstation,
    },
];

export const DEFAULT_PRESET_ID = 'classic-electribe';

/** Build a preset by id, falling back to Classic Electribe. */
export function buildPreset(id: string | undefined): AudioGraphConfig {
    const preset = GRAPH_PRESETS.find((candidate) => candidate.id === id);
    return (preset ?? GRAPH_PRESETS[0]).build();
}
