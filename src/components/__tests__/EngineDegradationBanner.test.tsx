import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EngineDegradationBanner } from '../EngineDegradationBanner';
import { engineDegradationStore } from '../../stores/engineDegradationStore';

describe('EngineDegradationBanner', () => {
    beforeEach(() => {
        engineDegradationStore.clear('gpu-knobs');
        engineDegradationStore.clear('open303');
    });

    it('renders nothing when no degradations are active', () => {
        const { container } = render(<EngineDegradationBanner />);
        expect(container.firstChild).toBeNull();
    });

    it('shows degradation message and retry button', () => {
        const retry = vi.fn().mockResolvedValue(undefined);
        engineDegradationStore.registerRetryHandler('gpu-knobs', retry);
        engineDegradationStore.report({
            id: 'gpu-knobs',
            subsystem: 'gpu-knobs',
            category: 'gpu',
            message: 'GPU knobs using 2D fallback',
            reason: 'WebGPU init failed',
            status: 'active',
            activeBackend: 'canvas-2d',
            requestedBackend: 'webgpu',
            retryable: true,
        });

        render(<EngineDegradationBanner />);
        expect(screen.getAllByText(/GPU knobs using 2D fallback/)[0]).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Retry gpu-knobs/i })).toBeInTheDocument();
    });

    it('collapses several fallbacks into one summary with details on demand', () => {
        for (const id of ['gpu-knobs', 'open303']) {
            engineDegradationStore.report({
                id,
                subsystem: id,
                category: 'gpu',
                message: `${id} fallback`,
                reason: 'test',
                status: 'active',
                activeBackend: 'js',
                requestedBackend: 'wasm',
                retryable: false,
            });
        }
        render(<EngineDegradationBanner />);
        expect(screen.getByText(/2 engines in fallback mode/i)).toBeInTheDocument();
        const details = screen.getByTestId('degradation-details') as HTMLDetailsElement;
        expect(details.open).toBe(false);
        // The rows are still in the DOM (for assistive tech) and the summary stays a single line.
        expect(screen.getByText('open303 fallback')).toBeInTheDocument();
    });

    it('never folds a suspended-audio problem away behind the details', () => {
        engineDegradationStore.report({
            id: 'audio-resume', subsystem: 'AudioContext', category: 'audio',
            message: 'Audio is suspended: click or press a key to start it', reason: 'blocked',
            status: 'active', activeBackend: 'suspended', requestedBackend: 'running', retryable: false,
        });
        for (const id of ['gpu-knobs', 'open303']) {
            engineDegradationStore.report({
                id, subsystem: id, category: 'gpu', message: `${id} fallback`, reason: 'test',
                status: 'active', activeBackend: 'js', requestedBackend: 'wasm', retryable: false,
            });
        }
        render(<EngineDegradationBanner />);
        const details = screen.getByTestId('degradation-details');
        const audio = screen.getAllByText(/Audio is suspended/)[0];
        expect(details.contains(audio)).toBe(false);
        engineDegradationStore.clear('audio-resume');
    });
});
