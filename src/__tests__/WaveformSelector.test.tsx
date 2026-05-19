import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { WaveformSelector } from '../components/WaveformSelector';

describe('WaveformSelector', () => {
  it('renders the wav-saw and wav-sqr buttons when expanded', async () => {
    const onChange = vi.fn();
    render(<WaveformSelector selected={'sawtooth'} onChange={onChange} accentColor="cyan" />);

    // Expand the panel
    const triggerBtn = screen.getByRole('button', { name: /Waveform selector: sawtooth/i });
    fireEvent.click(triggerBtn);

    // Buttons should be visible after expansion
    await waitFor(() => {
        expect(screen.getByRole('button', { name: /Select wav-saw waveform/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Select wav-sqr waveform/i })).toBeInTheDocument();
    });
  });

  it('selects wav-saw when button is clicked', async () => {
    const onChange = vi.fn();
    render(<WaveformSelector selected={'sawtooth'} onChange={onChange} accentColor="cyan" />);

    // Expand the panel
    const triggerBtn = screen.getByRole('button', { name: /Waveform selector: sawtooth/i });
    fireEvent.click(triggerBtn);

    const wavSawBtn = await screen.findByRole('button', { name: /Select wav-saw waveform/i });
    fireEvent.click(wavSawBtn);

    expect(onChange).toHaveBeenCalledWith('wav-saw');
  });

  it('cycles through basic waveforms when double-clicking trigger button', async () => {
    const onChange = vi.fn();
    render(<WaveformSelector selected={'sawtooth'} onChange={onChange} accentColor="cyan" />);

    // Double-click the trigger button to cycle
    const trigger = screen.getByRole('button', { name: /Waveform selector: sawtooth/i });
    fireEvent.doubleClick(trigger);

    // Should call onChange with the next waveform (square)
    expect(onChange).toHaveBeenCalledWith('square');
  });
});
