/**
 * The DWGS variant panel (#1666) follows the hardware panel it was recovered
 * from: a WAVEFORM SOURCE row (SAW / SQR / NOISE) and the digital waveforms as
 * a grid, every wave selectable by its persisted `dwgs-*` id.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { OscillatorVariantSelector } from '../OscillatorVariantSelector';
import { DWGS_WAVES } from '../../engines/dwgsWaves';
import { getDefaultWaveformForType, waveformToOscillatorType } from '../oscillatorThemes';

describe('OscillatorVariantSelector — DWGS', () => {
    it('offers the three panel sources and the fourteen digital waves', () => {
        render(<OscillatorVariantSelector type="dwgs" selected="dwgs-saw" onChange={() => {}} />);

        const source = screen.getByRole('group', { name: 'DWGS source waves' });
        expect(within(source).getAllByRole('button').map((b) => b.textContent)).toEqual(['SAW', 'SQR', 'NSE']);
        const digital = screen.getByRole('group', { name: 'DWGS digital waves' });
        expect(within(digital).getAllByRole('button')).toHaveLength(14);
        expect(screen.getByRole('button', { name: 'Select DWGS Organ (drawbars) wave' })).toHaveAttribute('title', 'DWGS Organ (drawbars) (dwgs-organ)');
    });

    it('selects by persisted id and marks the active wave', () => {
        const onChange = vi.fn();
        render(<OscillatorVariantSelector type="dwgs" selected="dwgs-bell" onChange={onChange} />);

        expect(screen.getByRole('button', { name: 'Select DWGS Bell (sparse partials) wave' })).toHaveAttribute('aria-pressed', 'true');
        fireEvent.click(screen.getByRole('button', { name: 'Select DWGS Noise (keyboard-tracking) wave' }));
        expect(onChange).toHaveBeenCalledWith('dwgs-noise');
        expect(screen.getAllByRole('button')).toHaveLength(DWGS_WAVES.length);
    });

    it('maps the family both ways in the theme helpers', () => {
        expect(getDefaultWaveformForType('dwgs')).toBe('dwgs-saw');
        for (const w of DWGS_WAVES) expect(waveformToOscillatorType(`dwgs-${w.suffix}` as never)).toBe('dwgs');
    });
});
