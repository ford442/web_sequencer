import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { WaveformSelector } from '../components/WaveformSelector';

describe('WaveformSelector', () => {
  it('renders the wav-saw and wav-sqr buttons', async () => {
    const onChange = vi.fn();
    render(<WaveformSelector selected={'sawtooth'} onChange={onChange} accentColor="cyan" />);

    // First find the trigger button and click it to open the popover
    const trigger = screen.getByLabelText(/Current waveform: sawtooth/i);
    fireEvent.click(trigger);

    // Now wait for the buttons to appear in the DOM
    await waitFor(() => {
        expect(screen.getByRole('button', { name: /Select wav-saw/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Select wav-sqr/i })).toBeInTheDocument();
    });
  });

  it('shows description when hovering over a waveform', async () => {
    const onChange = vi.fn();
    render(<WaveformSelector selected={'sawtooth'} onChange={onChange} accentColor="cyan" />);

    // Open popover
    const trigger = screen.getByLabelText(/Current waveform: sawtooth/i);
    fireEvent.click(trigger);

    // Wait for buttons
    await waitFor(() => {
        expect(screen.getByRole('button', { name: /Select wav-saw/i })).toBeInTheDocument();
    });

    // Find a button (e.g., wav-saw)
    const wavSawBtn = screen.getByRole('button', { name: /Select wav-saw/i });

    // Hover
    fireEvent.mouseEnter(wavSawBtn);

    // Check if description appears
    expect(screen.getByText('Sampled Sawtooth. Vintage analog character.')).toBeInTheDocument();

    // Mouse leave
    fireEvent.mouseLeave(wavSawBtn);

    // Should revert to selected waveform description (sawtooth)
    expect(screen.getByText('Standard Sawtooth. Rich harmonics, great for leads and basses.')).toBeInTheDocument();
  });
});
