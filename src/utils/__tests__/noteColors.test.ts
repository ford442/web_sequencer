import { describe, expect, it } from 'vitest';
import { getNoteColor } from '../noteColors';

describe('getNoteColor', () => {
    it('colours a name by the pitch it sounds, so enharmonic spellings match', () => {
        expect(getNoteColor('Eb3')).toBe(getNoteColor('D#3'));
        expect(getNoteColor('Db4')).toBe(getNoteColor('C#4'));
        expect(getNoteColor('Fx3')).toBe(getNoteColor('G3'));
        // Cb4 sounds as B3 and B#3 as C4 — the octave follows the pitch, not the spelling.
        expect(getNoteColor('Cb4')).toBe(getNoteColor('B3'));
        expect(getNoteColor('B#3')).toBe(getNoteColor('C4'));
    });

    it('keeps the existing hues and octave lightness', () => {
        expect(getNoteColor('C4')).toBe('hsl(0, 80%, 70%)');
        expect(getNoteColor('A#2')).toBe('hsl(300, 80%, 50%)');
        expect(getNoteColor('C9')).toBe('hsl(0, 80%, 80%)'); // lightness is capped at 80
    });

    it('gives the lowest octave a colour instead of the "unknown" grey', () => {
        expect(getNoteColor('C-1')).toBe('hsl(0, 80%, 20%)');
        expect(getNoteColor('C-1')).not.toBe(getNoteColor('nope'));
    });

    it('shifts partB by the complementary hue', () => {
        expect(getNoteColor('C4', 'partB')).toBe('hsl(180, 80%, 55%)');
    });

    it('is grey for anything that is not a note name', () => {
        for (const bad of ['nope', '', 'H4', 'c4', 'G#9', 'C#b4']) expect(getNoteColor(bad), JSON.stringify(bad)).toBe('#8fa394');
    });
});
