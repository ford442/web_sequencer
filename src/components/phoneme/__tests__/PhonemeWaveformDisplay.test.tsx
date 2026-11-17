import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { PhonemeWaveformDisplay } from '../PhonemeWaveformDisplay';

describe('PhonemeWaveformDisplay', () => {
    it('should render an empty state without role="status" since it is not dynamically updating', () => {
        const onLoadSampleMock = vi.fn();
        render(<PhonemeWaveformDisplay audioBuffer={null} width={800} height={200} phonemes={[]} onLoadSample={onLoadSampleMock} />);

        // The status text should be present
        const statusText = screen.getByText('No sample loaded');
        expect(statusText).toBeInTheDocument();

        // Ensure there is no status role
        expect(screen.queryByRole('status')).not.toBeInTheDocument();

        // The button should still be present
        const button = screen.getByRole('button', { name: 'Load Sample' });
        expect(button).toBeInTheDocument();
    });
});
