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
});
