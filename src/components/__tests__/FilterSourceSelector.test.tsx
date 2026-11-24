/**
 * The filter type + source picker (#1663): LP / BP / HP and Native / WASM OSC for
 * the oscillator families that run through the voice's filter stage, with the
 * fallback made visible when the WASM OSC filter was chosen but is not running.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { FilterSourceSelector, VOICE_FILTER_OSC_TYPES } from '../FilterSourceSelector';
import { engineDegradationStore } from '../../stores/engineDegradationStore';
import { logFilterSourceFallback } from '../../utils/engineTelemetry';

afterEach(() => {
    engineDegradationStore.clear('filter-source');
    vi.restoreAllMocks();
});

describe('FilterSourceSelector', () => {
    it('defaults an old song to a native low pass', () => {
        render(<FilterSourceSelector type="wam" onChange={() => {}} />);
        expect(screen.getByRole('button', { name: 'Low pass filter' })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('button', { name: 'Band pass filter' })).toHaveAttribute('aria-pressed', 'false');
        expect(screen.getByRole('button', { name: 'Native filter source' })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('button', { name: 'WASM OSC filter source' })).toHaveAttribute('aria-pressed', 'false');
    });

    it('reports each choice as a patch, so one click changes one field', () => {
        const onChange = vi.fn();
        render(<FilterSourceSelector type="rust" filterType="lp" filterSource="native" onChange={onChange} />);

        fireEvent.click(screen.getByRole('button', { name: 'High pass filter' }));
        expect(onChange).toHaveBeenLastCalledWith({ filterType: 'hp' });
        fireEvent.click(screen.getByRole('button', { name: 'Band pass filter' }));
        expect(onChange).toHaveBeenLastCalledWith({ filterType: 'bp' });
        fireEvent.click(screen.getByRole('button', { name: 'WASM OSC filter source' }));
        expect(onChange).toHaveBeenLastCalledWith({ filterSource: 'wam' });
    });

    it('shows the stored selection', () => {
        render(<FilterSourceSelector type="cpp" filterType="bp" filterSource="wam" onChange={() => {}} />);
        expect(screen.getByRole('button', { name: 'Band pass filter' })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('button', { name: 'WASM OSC filter source' })).toHaveAttribute('aria-pressed', 'true');
    });

    it.each([...VOICE_FILTER_OSC_TYPES])('is offered for %s, which runs through the voice filter', (type) => {
        render(<FilterSourceSelector type={type} onChange={() => {}} />);
        expect(screen.getByRole('group', { name: 'Filter type and source' })).toBeInTheDocument();
    });

    it.each(['open303', 'jc303', 'prophecy', 'macro'] as const)(
        'is not offered for %s: that engine owns its filter and would ignore the choice',
        (type) => {
            const { container } = render(<FilterSourceSelector type={type} onChange={() => {}} />);
            expect(container).toBeEmptyDOMElement();
        },
    );

    it('says so when the WASM OSC filter is selected but the voice fell back to the native one', () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        render(<FilterSourceSelector type="wam" filterSource="wam" onChange={() => {}} />);
        expect(screen.queryByRole('status')).toBeNull();

        act(() => logFilterSourceFallback('WASM OSC', 'Native', 'wamFilter.wasm fetch HTTP 404'));

        expect(screen.getByRole('status')).toHaveTextContent(/WASM OSC filter unavailable — using the native filter/);
        expect(screen.getByRole('status')).toHaveTextContent('HTTP 404');
    });

    it('does not show that notice for a voice that never asked for the WASM OSC filter', () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        render(<FilterSourceSelector type="wam" filterSource="native" onChange={() => {}} />);
        act(() => logFilterSourceFallback('WASM OSC', 'Native', 'some other voice asked'));
        expect(screen.queryByRole('status')).toBeNull();
    });
});
