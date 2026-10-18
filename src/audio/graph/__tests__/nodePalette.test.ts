import { describe, expect, it } from 'vitest';
import { CLASSIC_ELECTRIBE_GRAPH } from '../defaultElectribeGraph';
import { isEngineVoiceFactory } from '../engineVoices';
import { addNode, validateGraph } from '../graphOps';
import { NODE_PALETTE, createPaletteNode, paletteDefaults } from '../nodePalette';

describe('node palette', () => {
    it('offers processing nodes only — never an engine or a WAM2 slot', () => {
        for (const entry of NODE_PALETTE) {
            expect(isEngineVoiceFactory(entry.factory)).toBe(false);
            expect(entry.factory.startsWith('wam')).toBe(false);
        }
    });

    it('gives each new node an id the patch does not already use', () => {
        const gain = NODE_PALETTE.find((entry) => entry.factory === 'gain')!;
        const first = createPaletteNode(CLASSIC_ELECTRIBE_GRAPH, gain);
        const withFirst = addNode(CLASSIC_ELECTRIBE_GRAPH, first).config;
        const second = createPaletteNode(withFirst, gain);
        expect(first.id).toBe('gain-1');
        expect(second.id).toBe('gain-2');
        expect(validateGraph(addNode(withFirst, second).config).valid).toBe(true);
    });

    it('clamps parameter values into range and keeps the entry base config', () => {
        const lowpass = NODE_PALETTE.find((entry) => entry.label === 'Low-pass')!;
        const node = createPaletteNode(CLASSIC_ELECTRIBE_GRAPH, lowpass, {
            frequency: 1e9,
            Q: Number.NaN,
        });
        expect(node.config).toEqual({ type: 'lowpass', frequency: 18000, Q: 0.7 });
        expect(paletteDefaults(lowpass)).toEqual({ frequency: 2000, Q: 0.7 });
        expect(node.fixed).toBeUndefined();
    });
});
