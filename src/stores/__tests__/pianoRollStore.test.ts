import { afterEach, describe, expect, it, vi } from 'vitest';
import { isPianoRollTrack, pianoRollStore } from '../pianoRollStore';

describe('pianoRollStore', () => {
    afterEach(() => pianoRollStore.reset());

    it('opens a melodic track, clamps sampler banks and ignores the bank for synths', () => {
        pianoRollStore.open('sampler', 12);
        expect(pianoRollStore.getSnapshot().open).toEqual({ track: 'sampler', bank: 7 });
        pianoRollStore.open('bass2', 5);
        expect(pianoRollStore.getSnapshot().open).toEqual({ track: 'bass2', bank: 0 });
    });

    it('toggles the same target closed and notifies only on change', () => {
        const listener = vi.fn();
        const unsub = pianoRollStore.subscribe(listener);
        pianoRollStore.toggle('partA');
        pianoRollStore.open('partA');
        expect(listener).toHaveBeenCalledTimes(1);
        pianoRollStore.toggle('partA');
        expect(pianoRollStore.getSnapshot().open).toBeNull();
        expect(listener).toHaveBeenCalledTimes(2);
        unsub();
    });

    it('returns focus to the element that opened it', () => {
        const button = document.createElement('button');
        document.body.appendChild(button);
        button.focus();
        pianoRollStore.open('partB');
        const other = document.createElement('button');
        document.body.appendChild(other);
        other.focus();
        pianoRollStore.close();
        expect(document.activeElement).toBe(button);
        button.remove();
        other.remove();
    });

    it('returns focus to an SVG chip (the row-header chip is a focusable <g>)', () => {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        const chip = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        chip.setAttribute('tabindex', '0');
        svg.appendChild(chip);
        document.body.appendChild(svg);
        chip.focus();
        expect(document.activeElement).toBe(chip);
        pianoRollStore.open('partA');
        const other = document.createElement('button');
        document.body.appendChild(other);
        other.focus();
        pianoRollStore.close();
        expect(document.activeElement).toBe(chip);
        svg.remove();
        other.remove();
    });

    it('only melodic tracks have a roll', () => {
        expect(isPianoRollTrack('partA')).toBe(true);
        expect(isPianoRollTrack('sampler')).toBe(true);
        expect(isPianoRollTrack('kick')).toBe(false);
    });
});
