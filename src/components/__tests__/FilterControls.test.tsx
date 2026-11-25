import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { FilterControls } from '../FilterControls';
import { engineDegradationStore } from '../../stores/engineDegradationStore';
import { filterSourceIssueId } from '../../engines/backends/filterSource';
import { logFilterSourceFallback } from '../../utils/engineTelemetry';

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

    it('renders nothing for oscillator families that own their filter', () => {
        for (const type of ['open303', 'jc303', 'prophecy', 'macro'] as const) {
            const { container, unmount } = render(<FilterControls type={type} onChange={() => {}} />);
            expect(container).toBeEmptyDOMElement();
            unmount();
        }
        render(<FilterControls type="rust" onChange={() => {}} />);
        expect(screen.getByRole('group', { name: 'Filter controls' })).toBeInTheDocument();
    });

    it("marks the oscillator's own filter source", () => {
        render(<FilterControls type="rust" onChange={() => {}} />);
        expect(screen.getByRole('button', { name: 'Rust filter source' })).toHaveAttribute('data-own-filter', 'true');
        expect(screen.getByRole('button', { name: 'C++ filter source' })).not.toHaveAttribute('data-own-filter');
    });

    it('shows the fallback notice when the chosen source is not running', () => {
        render(<FilterControls type="wam" filterSource="rust" onChange={() => {}} />);
        act(() => { logFilterSourceFallback('rust', 'native', 'no wasm simd', filterSourceIssueId('rust')); });
        expect(screen.getByRole('status')).toHaveTextContent(/Rust filter unavailable/);
        act(() => engineDegradationStore.clear(filterSourceIssueId('rust')));
    });
});
