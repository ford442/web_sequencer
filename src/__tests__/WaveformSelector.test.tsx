import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { WaveformSelector } from '../components/WaveformSelector';

describe('WaveformSelector', () => {
  it('renders the wav-saw and wav-sqr buttons', async () => {
    const onChange = vi.fn();
    render(<WaveformSelector selected={'sawtooth'} onChange={onChange} accentColor="cyan" />);

    // Buttons should be visible immediately in the new column layout
    await waitFor(() => {
        expect(screen.getByRole('button', { name: /Select wav-saw waveform/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Select wav-sqr waveform/i })).toBeInTheDocument();
    });
  });

  it('selects wav-saw when button is clicked', async () => {
    const onChange = vi.fn();
    render(<WaveformSelector selected={'sawtooth'} onChange={onChange} accentColor="cyan" />);

    const wavSawBtn = screen.getByRole('button', { name: /Select wav-saw waveform/i });
    fireEvent.click(wavSawBtn);

    expect(onChange).toHaveBeenCalledWith('wav-saw');
  });

  it('cycles through basic waveforms when main button is clicked', async () => {
    const onChange = vi.fn();
    render(<WaveformSelector selected={'sawtooth'} onChange={onChange} accentColor="cyan" />);

    // Find the main waveform button and click it
    const trigger = screen.getByLabelText(/Current waveform: sawtooth\. Click to cycle/i);
    fireEvent.click(trigger);

    // Should call onChange with the next waveform (square)
    expect(onChange).toHaveBeenCalledWith('square');
  });
});
