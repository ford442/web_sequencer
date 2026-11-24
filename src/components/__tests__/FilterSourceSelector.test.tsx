/**
 * The filter type + source picker (#1663, #1672, #1673, #1674, #1675): LP / BP / HP and Native /
 * WASM OSC / Rust / C++ / DWGS / WebGPU for the oscillator families that run through the voice's filter
 * stage, with the fallback made visible when a wasm filter was chosen but is not
 * running.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { FilterSourceSelector, VOICE_FILTER_OSC_TYPES } from '../FilterSourceSelector';
import { engineDegradationStore } from '../../stores/engineDegradationStore';
import { filterSourceIssueId } from '../../engines/backends/filterSource';
import { logFilterSourceFallback } from '../../utils/engineTelemetry';

afterEach(() => {
    for (const source of ['wam', 'rust', 'cpp', 'dwgs', 'webgpu'] as const) engineDegradationStore.clear(filterSourceIssueId(source));
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

    it('offers the Rust filter for every filtered oscillator family, independent of the oscillator shape', () => {
        const onChange = vi.fn();
        for (const type of VOICE_FILTER_OSC_TYPES) {
            const { unmount } = render(<FilterSourceSelector type={type} onChange={onChange} />);
            fireEvent.click(screen.getByRole('button', { name: 'Rust filter source' }));
            expect(onChange).toHaveBeenLastCalledWith({ filterSource: 'rust' });
            unmount();
        }
    });

    it('offers the C++ filter for every filtered oscillator family, cpp-* included', () => {
        const onChange = vi.fn();
        for (const type of VOICE_FILTER_OSC_TYPES) {
            const { unmount } = render(<FilterSourceSelector type={type} onChange={onChange} />);
            fireEvent.click(screen.getByRole('button', { name: 'C++ filter source' }));
            expect(onChange).toHaveBeenLastCalledWith({ filterSource: 'cpp' });
            unmount();
        }
        expect([...VOICE_FILTER_OSC_TYPES]).toEqual(
            expect.arrayContaining(['javascript', 'pcm', 'pyodide', 'webgpu', 'wam', 'rust', 'cpp', 'dwgs']),
        );
    });

    it('says so for the C++ filter, and another source\'s failure does not show on a C++ voice', () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        render(<FilterSourceSelector type="dwgs" filterSource="cpp" onChange={() => {}} />);

        act(() => logFilterSourceFallback('Rust', 'Native', 'rust is down', filterSourceIssueId('rust')));
        expect(screen.queryByRole('status')).toBeNull();

        act(() => logFilterSourceFallback('C++', 'Native', 'cpp_osc.wasm fetch HTTP 404', filterSourceIssueId('cpp')));
        expect(screen.getByRole('status')).toHaveTextContent(/C\+\+ filter unavailable — using the native filter/);
        expect(screen.getByRole('status')).toHaveTextContent('HTTP 404');
    });

    it('offers the DWGS filter for every filtered oscillator family, dwgs-* included', () => {
        const onChange = vi.fn();
        for (const type of VOICE_FILTER_OSC_TYPES) {
            const { unmount } = render(<FilterSourceSelector type={type} onChange={onChange} />);
            const button = screen.getByRole('button', { name: 'DWGS filter source' });
            expect(button).toHaveAttribute('title', expect.stringMatching(/24 dB\/oct ladder/));
            fireEvent.click(button);
            expect(onChange).toHaveBeenLastCalledWith({ filterSource: 'dwgs' });
            unmount();
        }
    });

    it('says so for the DWGS filter, and another source\'s failure does not show on a DWGS voice', () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        render(<FilterSourceSelector type="rust" filterSource="dwgs" onChange={() => {}} />);

        act(() => logFilterSourceFallback('C++', 'Native', 'cpp is down', filterSourceIssueId('cpp')));
        expect(screen.queryByRole('status')).toBeNull();

        act(() => logFilterSourceFallback('DWGS', 'Native', 'dwgs_osc.wasm fetch HTTP 404', filterSourceIssueId('dwgs')));
        expect(screen.getByRole('status')).toHaveTextContent(/DWGS filter unavailable — using the native filter/);
        expect(screen.getByRole('status')).toHaveTextContent('HTTP 404');
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

        act(() => logFilterSourceFallback('WASM OSC', 'Native', 'wamFilter.wasm fetch HTTP 404', filterSourceIssueId('wam')));

        expect(screen.getByRole('status')).toHaveTextContent(/WASM OSC filter unavailable — using the native filter/);
        expect(screen.getByRole('status')).toHaveTextContent('HTTP 404');
    });

    it('says so for the Rust filter too, and a WASM OSC failure does not show on a Rust voice', () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        render(<FilterSourceSelector type="wam" filterSource="rust" onChange={() => {}} />);

        act(() => logFilterSourceFallback('WASM OSC', 'Native', 'wam is down', filterSourceIssueId('wam')));
        expect(screen.queryByRole('status')).toBeNull();

        act(() => logFilterSourceFallback('Rust', 'Native', 'rust_osc.wasm fetch HTTP 404', filterSourceIssueId('rust')));
        expect(screen.getByRole('status')).toHaveTextContent(/Rust filter unavailable — using the native filter/);
        expect(screen.getByRole('status')).toHaveTextContent('HTTP 404');
    });

    it('does not show that notice for a voice that never asked for the WASM OSC filter', () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        render(<FilterSourceSelector type="wam" filterSource="native" onChange={() => {}} />);
        act(() => logFilterSourceFallback('WASM OSC', 'Native', 'some other voice asked', filterSourceIssueId('wam')));
        expect(screen.queryByRole('status')).toBeNull();
    });
    it('offers the WebGPU filter for every filtered oscillator family', () => {
        const onChange = vi.fn();
        for (const type of VOICE_FILTER_OSC_TYPES) {
            const { unmount } = render(<FilterSourceSelector type={type} onChange={onChange} />);
            fireEvent.click(screen.getByRole('button', { name: 'WebGPU filter source' }));
            expect(onChange).toHaveBeenLastCalledWith({ filterSource: 'webgpu' });
            unmount();
        }
    });

    it('explains what the WebGPU filter plays, but only while it is selected', () => {
        const { rerender } = render(<FilterSourceSelector type="rust" filterSource="native" onChange={() => {}} />);
        expect(screen.queryByTestId('webgpu-filter-note')).toBeNull();
        rerender(<FilterSourceSelector type="rust" filterSource="webgpu" onChange={() => {}} />);
        expect(screen.getByTestId('webgpu-filter-note')).toHaveTextContent(/GPU/);
        expect(screen.getByTestId('webgpu-filter-note')).toHaveTextContent(/not the selected oscillator engine/);
    });

    it('says so when the WebGPU filter is selected but the voice fell back to the native one', () => {
        logFilterSourceFallback('WebGPU', 'Native', 'WebGPU is unavailable (no adapter, or the device was lost)', filterSourceIssueId('webgpu'));
        render(<FilterSourceSelector type="wam" filterSource="webgpu" onChange={() => {}} />);
        expect(screen.getByRole('status')).toHaveTextContent(/WebGPU filter unavailable/);
        expect(screen.getByRole('status')).toHaveTextContent(/device was lost/);
        // The explanation of what it plays gives way to the failure.
        expect(screen.queryByTestId('webgpu-filter-note')).toBeNull();
    });

    it('does not show the WebGPU failure on a voice that never asked for it', () => {
        logFilterSourceFallback('WebGPU', 'Native', 'webgpu notice-isolation unit test', filterSourceIssueId('webgpu'));
        render(<FilterSourceSelector type="wam" filterSource="rust" onChange={() => {}} />);
        expect(screen.queryByRole('status')).toBeNull();
    });
});
