// The Pyodide filter's table geometry and refusals (#1676), pure.

import { describe, expect, it } from 'vitest';
import { BANK_MIDI_HIGH, BANK_MIDI_LOW } from '../gpuFilter';
import { MIN_TABLE_LENGTH, planPyodideTable, pyodideFilterRefusal } from '../pyodideFilter';
import { isTableFilterSource, FILTER_SOURCE_LABELS, FILTER_SOURCE_DESCRIPTIONS, STAGED_FILTER_SOURCES } from '../filterSource';
import { parseWaveform } from '../../../utils/waveformParser';
import { midiToHz } from '../../../utils/math';

const centsOff = (a: number, b: number) => Math.abs(1200 * Math.log2(a / b));

describe('planPyodideTable', () => {
    it.each([44100, 48000, 96000])('holds whole periods and sounds within a cent of its note, for every note, at %i Hz', (rate) => {
        let planned = 0;
        for (let midi = BANK_MIDI_LOW; midi <= BANK_MIDI_HIGH; midi++) {
            const f0 = midiToHz(midi);
            const plan = planPyodideTable(f0, rate);
            if (f0 >= rate / 2) {
                expect(plan).toBeNull(); // nothing to render at or above Nyquist
                continue;
            }
            expect(plan).not.toBeNull();
            planned++;
            const p = plan!;
            expect(p.midi).toBe(midi);
            expect(Number.isInteger(p.cycles) && p.cycles >= 1).toBe(true);
            expect(Number.isInteger(p.length)).toBe(true);
            expect(p.length).toBeGreaterThanOrEqual(MIN_TABLE_LENGTH - 1);
            expect(Math.floor(p.length / 2) - 1).toBeGreaterThanOrEqual(p.cycles); // the fundamental is below Nyquist
            expect(p.baseFrequency).toBeCloseTo((rate * p.cycles) / p.length, 9);
            // The loop is played at playbackRate ≈ 1: within a cent, so no resampling and no cutoff drift.
            expect(centsOff(p.baseFrequency, f0)).toBeLessThan(1);
        }
        expect(planned).toBeGreaterThan(90);
    });

    it('takes the nearest note for a pitch between notes', () => {
        expect(planPyodideTable(440 * 2 ** (30 / 1200), 48000)?.midi).toBe(69);
        expect(planPyodideTable(440 * 2 ** (70 / 1200), 48000)?.midi).toBe(70);
    });

    it('serves one period for a low note, and many for a high one', () => {
        expect(planPyodideTable(midiToHz(12), 48000)?.cycles).toBe(1);
        expect(planPyodideTable(midiToHz(100), 48000)!.cycles).toBeGreaterThan(50);
    });

    it.each([0, -5, Number.NaN, Number.POSITIVE_INFINITY, 5, 20000 * 4])('has no table for %s Hz', (hz) => {
        expect(planPyodideTable(hz, 48000)).toBeNull();
    });
});

describe('pyodideFilterRefusal', () => {
    it.each(['sawtooth', 'wam-saw', 'rust-sqr', 'cpp-tri', 'pyodide-sin', 'wgsl-saw', 'dwgs-saw', 'dwgs-sqr', 'dwgs-sine'])('renders %s', (wf) => {
        expect(pyodideFilterRefusal(parseWaveform(wf))).toBeNull();
    });

    it('names a DWGS digital wave and the Pyodide filter when it refuses', () => {
        const reason = pyodideFilterRefusal(parseWaveform('dwgs-piano'));
        expect(reason).toContain('dwgs-piano');
        expect(reason).toContain('Pyodide');
    });
});

describe('the Pyodide source in the shared filter policy', () => {
    it('is a table filter, not a worklet stage', () => {
        expect(isTableFilterSource('pyodide')).toBe(true);
        expect(isTableFilterSource('webgpu')).toBe(true);
        for (const s of ['native', 'wam', 'rust', 'cpp', 'dwgs'] as const) expect(isTableFilterSource(s)).toBe(false);
        expect(STAGED_FILTER_SOURCES).not.toContain('pyodide');
    });

    it('is labelled "Pyodide", like its oscillator, and describes itself', () => {
        expect(FILTER_SOURCE_LABELS.pyodide).toBe('Pyodide');
        expect(FILTER_SOURCE_DESCRIPTIONS.pyodide).toMatch(/SciPy/);
        expect(FILTER_SOURCE_DESCRIPTIONS.pyodide).toMatch(/audio thread/);
    });
});
