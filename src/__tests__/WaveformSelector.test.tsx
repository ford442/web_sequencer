// No direct React import required with JSX runtime; remove to avoid unused import error
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WaveformSelector } from '../components/WaveformSelector';
import type { Waveform } from '../types';

describe('WaveformSelector', () => {
  it('renders the wav-saw and wav-sqr buttons', () => {
    const onChange = (_w: Waveform) => {};
    render(<WaveformSelector selected={'sawtooth'} onChange={onChange} accentColor="cyan" />);

    const wavSawBtn = screen.getByRole('button', { name: /Select wav-saw waveform/i });
    const wavSqrBtn = screen.getByRole('button', { name: /Select wav-sqr waveform/i });

    expect(wavSawBtn).toBeInTheDocument();
    expect(wavSqrBtn).toBeInTheDocument();
    // Visible assertion uses style or computed; in test environment, we ensure it exists
    expect(wavSawBtn).toBeVisible();
    expect(wavSqrBtn).toBeVisible();
  });
});

