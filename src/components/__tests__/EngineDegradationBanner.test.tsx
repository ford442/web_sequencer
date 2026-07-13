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
        expect(screen.getByText(/GPU knobs using 2D fallback/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Retry gpu-knobs/i })).toBeInTheDocument();
    });
});
