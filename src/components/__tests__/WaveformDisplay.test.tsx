import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { WaveformDisplay } from '../WaveformDisplay';
import type { AlignmentResult } from '../../engines/rubberband/PhonemeAligner';

describe('WaveformDisplay', () => {
    it('renders with correct accessibility label when no buffer is loaded', () => {
        const sliceHighlightRef = { current: null };
        render(<WaveformDisplay buffer={null} alignment={null} sliceHighlightRef={sliceHighlightRef} />);

        const display = screen.getByRole('img');
        expect(display).toHaveAttribute('aria-label', 'Waveform visualization: No sample loaded');
        expect(display).toHaveAttribute('title', 'Waveform visualization: No sample loaded');
    });

    it('renders with correct accessibility label when buffer is loaded', () => {
        const sliceHighlightRef = { current: null };
        const mockBuffer = {
            duration: 1,
            length: 100,
            sampleRate: 44100,
            numberOfChannels: 1,
            getChannelData: () => new Float32Array(100)
        } as unknown as AudioBuffer;

        render(<WaveformDisplay buffer={mockBuffer} alignment={null} sliceHighlightRef={sliceHighlightRef} />);

        const display = screen.getByRole('img');
        expect(display).toHaveAttribute('aria-label', 'Waveform visualization: Sample loaded');
        expect(display).toHaveAttribute('title', 'Waveform visualization: Sample loaded');
    });

    it('renders with correct accessibility label when buffer and alignment are loaded', () => {
        const sliceHighlightRef = { current: null };
        const mockBuffer = {
            duration: 1,
            length: 100,
            sampleRate: 44100,
            numberOfChannels: 1,
            getChannelData: () => new Float32Array(100)
        } as unknown as AudioBuffer;

        const mockAlignment: AlignmentResult = {
            phonemes: [{ phoneme: 'AH', start: 0, end: 1, score: 0.9 }]
        };

        render(<WaveformDisplay buffer={mockBuffer} alignment={mockAlignment} sliceHighlightRef={sliceHighlightRef} />);

        const display = screen.getByRole('img');
        expect(display).toHaveAttribute('aria-label', 'Waveform visualization: Sample loaded with phoneme alignment');
        expect(display).toHaveAttribute('title', 'Waveform visualization: Sample loaded with phoneme alignment');
    });
});
