import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { Voice303Selector } from '../Voice303Selector';
import { getAvailableTB303Models } from '../../engines/TB303Models';
import { engineDegradationStore } from '../../stores/engineDegradationStore';
import { engineTelemetry } from '../../utils/engineTelemetry';

describe('Voice303Selector', () => {
    it('renders one button per available voice including offline high-fid', () => {
        render(<Voice303Selector model="stock-open303" onChange={vi.fn()} gpuAvailable />);
        for (const m of getAvailableTB303Models({ includeOfflineOnly: true })) {
            expect(screen.getByRole('button', { name: `Select ${m.label} voice` })).toBeInTheDocument();
        }
    });

    it('marks the active voice with aria-pressed', () => {
        render(<Voice303Selector model="experimental-01" onChange={vi.fn()} />);
        expect(screen.getByRole('button', { name: 'Select Experimental 01 voice' }))
            .toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('button', { name: 'Select Stock Open303 voice' }))
            .toHaveAttribute('aria-pressed', 'false');
    });

    it('calls onChange with the picked model id', () => {
        const onChange = vi.fn();
        render(<Voice303Selector model="stock-open303" onChange={onChange} />);
        fireEvent.click(screen.getByRole('button', { name: 'Select Authentic JC303 voice' }));
        expect(onChange).toHaveBeenCalledWith('jc303');
    });

    it('exposes the voice description as a tooltip (offline voices mention freeze/export)', () => {
        render(<Voice303Selector model="stock-open303" onChange={vi.fn()} gpuAvailable />);
        for (const m of getAvailableTB303Models({ includeOfflineOnly: true })) {
            const btn = screen.getByRole('button', { name: `Select ${m.label} voice` });
            const title = btn.getAttribute('title') ?? '';
            expect(title).toContain(m.description.slice(0, 24));
            if (m.offlineOnly) {
                expect(title.toLowerCase()).toMatch(/offline|freeze|export|multisample/);
            }
        }
    });

    it('shows Offline badges on high-fid voices', () => {
        render(<Voice303Selector model="stock-open303" onChange={vi.fn()} gpuAvailable />);
        const offlineBadges = screen.getAllByText('Offline');
        expect(offlineBadges.length).toBeGreaterThanOrEqual(2);
    });

    it('shows the OPEN303 family badge for open303-family voices', () => {
        render(<Voice303Selector model="1ink303-v1" onChange={vi.fn()} />);
        expect(screen.getByLabelText('Open303 engine family active')).toBeInTheDocument();
    });

    it('shows the JC303 family badge when a jc303-family voice is active', () => {
        render(<Voice303Selector model="jc303" onChange={vi.fn()} />);
        expect(screen.getByLabelText('JC303 engine family active')).toBeInTheDocument();
    });

    it('shows HIFID badge and status when a high-fid voice is active', () => {
        render(
            <Voice303Selector model="highfid-cpu" onChange={vi.fn()} gpuAvailable={false} />,
        );
        expect(screen.getByLabelText('High-fidelity offline engine family active')).toBeInTheDocument();
        expect(screen.getByText(/Offline engine: highfid-cpu/i)).toBeInTheDocument();
    });

    it('shows No GPU badge and fallback message when selecting gpu-highfid without WebGPU', () => {
        engineDegradationStore.clear('gpu-highfid-selection');
        const onChange = vi.fn();
        render(
            <Voice303Selector model="stock-open303" onChange={onChange} gpuAvailable={false} />,
        );
        expect(screen.getByLabelText(/WebGPU unavailable/i)).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /Select GPU High-Fidelity/i }));
        expect(onChange).toHaveBeenCalledWith('gpu-highfid');

        const snap = engineTelemetry.getRuntimeSnapshot();
        expect(snap.highFidRequested).toBe('gpu-highfid');
        expect(snap.highFidActiveEngine).toBe('highfid-cpu');
        expect(snap.highFidFallbackReason).toMatch(/WebGPU unavailable/i);
        expect(engineDegradationStore.getIssue('gpu-highfid-selection')?.activeBackend).toBe(
            'highfid-cpu',
        );
    });

    it('persists gpu-highfid selection and shows CPU fallback status when GPU is unavailable', () => {
        render(
            <Voice303Selector model="gpu-highfid" onChange={vi.fn()} gpuAvailable={false} />,
        );
        expect(screen.getByRole('status')).toHaveTextContent(/WebGPU unavailable/i);
    });

    it('is grouped and labelled for assistive tech', () => {
        render(<Voice303Selector model="stock-open303" onChange={vi.fn()} />);
        expect(screen.getByRole('group', { name: '303 voice selection' })).toBeInTheDocument();
    });
});

describe('Voice303Selector — live A/B + diode-ladder coefficients (L2/L3)', () => {
    it('offers A/B only on the live high-fid voice', () => {
        const { rerender } = render(
            <Voice303Selector model="stock-open303" onChange={vi.fn()} onLiveAbChange={vi.fn()} />,
        );
        expect(screen.queryByRole('button', { name: 'A/B vs stock' })).not.toBeInTheDocument();
        rerender(<Voice303Selector model="live-highfid" onChange={vi.fn()} onLiveAbChange={vi.fn()} />);
        expect(screen.getByRole('button', { name: 'A/B vs stock' })).toHaveAttribute('aria-pressed', 'false');
        // The amber Live pill is unchanged.
        expect(screen.getByRole('button', { name: 'Select Live High-Fidelity voice' })).toHaveTextContent('Live');
    });

    it('arms, flips and blends through onLiveAbChange', () => {
        const onLiveAbChange = vi.fn();
        const { rerender } = render(
            <Voice303Selector model="live-highfid" onChange={vi.fn()} onLiveAbChange={onLiveAbChange} />,
        );
        fireEvent.click(screen.getByRole('button', { name: 'A/B vs stock' }));
        expect(onLiveAbChange).toHaveBeenLastCalledWith({ armed: true, mix: 1 });

        rerender(
            <Voice303Selector
                model="live-highfid"
                onChange={vi.fn()}
                liveAb={{ armed: true, mix: 1 }}
                onLiveAbChange={onLiveAbChange}
            />,
        );
        expect(screen.getByRole('button', { name: 'Flip to B (live high-fidelity)' })).toHaveAttribute('aria-pressed', 'true');
        fireEvent.click(screen.getByRole('button', { name: 'Flip to A (Stock Open303)' }));
        expect(onLiveAbChange).toHaveBeenLastCalledWith({ armed: true, mix: 0 });
        fireEvent.change(screen.getByRole('slider', { name: 'A/B blend, stock to high-fidelity' }), {
            target: { value: '30' },
        });
        expect(onLiveAbChange).toHaveBeenLastCalledWith({ armed: true, mix: 0.3 });
        expect(screen.getByText(/Freeze records B \(high-fid\)/)).toBeInTheDocument();
    });

    it('edits coefficients for diode-ladder voices and resets to canonical', () => {
        const onCoeffs = vi.fn();
        const { rerender } = render(
            <Voice303Selector model="jc303" onChange={vi.fn()} onHighFidCoefficientsChange={onCoeffs} />,
        );
        expect(screen.queryByText(/Diode ladder/)).not.toBeInTheDocument();

        rerender(<Voice303Selector model="live-highfid" onChange={vi.fn()} onHighFidCoefficientsChange={onCoeffs} />);
        expect(screen.getByText(/Diode ladder · canonical/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Canonical' })).toBeDisabled();
        fireEvent.change(
            screen.getByRole('slider', { name: 'Transistor mismatch — spreads the four ladder poles' }),
            { target: { value: '40' } },
        );
        expect(onCoeffs).toHaveBeenLastCalledWith({
            transistorMismatch: 0.4,
            decayCurve: 0,
            accentCoupling: 0.45,
            filterTracking: 0,
        });

        rerender(
            <Voice303Selector
                model="highfid-cpu"
                onChange={vi.fn()}
                highFidCoefficients={{ transistorMismatch: 0.4, decayCurve: 0, accentCoupling: 0.45, filterTracking: 0 }}
                onHighFidCoefficientsChange={onCoeffs}
            />,
        );
        expect(screen.getByText(/Diode ladder · edited/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Canonical' }));
        expect(onCoeffs).toHaveBeenLastCalledWith(undefined);
    });
});
