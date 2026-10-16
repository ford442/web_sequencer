import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { PhonemeWaveformDisplay } from '../PhonemeWaveformDisplay';

describe('PhonemeWaveformDisplay', () => {
    it('should place role="status" on the inner wrapper to avoid announcing interactive elements', () => {
        const onLoadSampleMock = vi.fn();
        render(<PhonemeWaveformDisplay audioBuffer={null} width={800} height={200} phonemes={[]} onLoadSample={onLoadSampleMock} />);

        // The status region should be present
        const statusRegion = screen.getByRole('status');
        expect(statusRegion).toBeInTheDocument();

        // The status text should be inside the status region
        expect(statusRegion).toHaveTextContent('No sample loaded');

        // The button should NOT be inside the status region
        const button = screen.getByRole('button', { name: 'Load Sample' });
        expect(button).toBeInTheDocument();
        expect(statusRegion).not.toContainElement(button);
    });
});
