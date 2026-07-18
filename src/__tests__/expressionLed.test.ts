import { describe, it, expect, beforeEach } from 'vitest';
import { expressionLedStore } from '../stores/expressionLedStore';
import { pulseExpressionLed } from '../audio/expressionLedPulse';
import { getNoteColor } from '../utils/noteColors';

describe('expressionLedStore', () => {
    beforeEach(() => {
        expressionLedStore.pulse('kick', '#ff0000', 1);
        expressionLedStore.tick();
        expressionLedStore.tick();
        while (expressionLedStore.getChannel('kick')) {
            expressionLedStore.tick();
        }
    });

    it('stores and retrieves a pulse channel', () => {
        expressionLedStore.pulse('synthA', 'hsl(120, 80%, 50%)', 1);
        expect(expressionLedStore.getChannel('synthA')).toEqual({
            noteColor: 'hsl(120, 80%, 50%)',
            envelope: 1,
        });
    });

    it('decays envelope over ticks', () => {
        expressionLedStore.pulse('snare', '#00ff00', 1);
        const before = expressionLedStore.getChannel('snare')!.envelope;
        expressionLedStore.tick();
        const after = expressionLedStore.getChannel('snare')!.envelope;
        expect(after).toBeLessThan(before);
    });
});

describe('pulseExpressionLed', () => {
    it('uses sequencer note colors for melodic targets', () => {
        pulseExpressionLed('synthA', 'C4');
        expect(expressionLedStore.getChannel('synthA')?.noteColor).toBe(getNoteColor('C4', 'partA'));
    });

    it('uses track fallback color for drums without a note', () => {
        pulseExpressionLed('kick');
        expect(expressionLedStore.getChannel('kick')?.noteColor).toBe('#f97316');
    });
});
