import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { FilterControls } from '../FilterControls';

describe('FilterControls', () => {
    it('shows the source topology: DWGS is 4-pole, 2-pole disabled but present', () => {
        render(<FilterControls filterSource="dwgs" onChange={() => {}} />);
        expect(screen.getByRole('button', { name: '4 poles' })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('button', { name: '2 poles' })).toBeDisabled();
    });

    it('defaults to native LP, 2 poles; all modes enabled', () => {
        render(<FilterControls onChange={() => {}} />);
        expect(screen.getByRole('button', { name: 'Low pass mode' })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('button', { name: '2 poles' })).toHaveAttribute('aria-pressed', 'true');
        for (const n of ['Low pass mode', 'Band pass mode', 'High pass mode']) {
            expect(screen.getByRole('button', { name: n })).toBeEnabled();
        }
    });

    it('reports mode, source, cutoff and resonance as patches', () => {
        const onChange = vi.fn();
        render(<FilterControls filterCutoff={1000} filterResonance={4} onChange={onChange} />);
        fireEvent.click(screen.getByRole('button', { name: 'High pass mode' }));
        expect(onChange).toHaveBeenLastCalledWith({ filterType: 'hp' });
        fireEvent.click(screen.getByRole('button', { name: 'DWGS filter source' }));
        expect(onChange).toHaveBeenLastCalledWith({ filterSource: 'dwgs' });
        fireEvent.change(screen.getByLabelText('Filter cutoff'), { target: { value: '2000' } });
        expect(onChange).toHaveBeenLastCalledWith({ filterCutoff: 2000 });
        fireEvent.change(screen.getByLabelText('Filter resonance'), { target: { value: '6' } });
        expect(onChange).toHaveBeenLastCalledWith({ filterResonance: 6 });
    });

    it('notes that table sources regenerate on change', () => {
        render(<FilterControls filterSource="webgpu" onChange={() => {}} />);
        expect(screen.getByTestId('filter-regenerates-note')).toBeInTheDocument();
    });
});
