import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { WaveformSelector } from '../WaveformSelector';
import userEvent from '@testing-library/user-event';

describe('WaveformSelector', () => {
    it('renders trigger button with correct label', () => {
        const onChange = vi.fn();
        render(<WaveformSelector selected="sawtooth" onChange={onChange} accentColor="cyan" />);

        const button = screen.getByRole('button', { name: /Current waveform: sawtooth/i });
        expect(button).toBeInTheDocument();
    });

    it('opens popover on click', async () => {
        const onChange = vi.fn();
        render(<WaveformSelector selected="sawtooth" onChange={onChange} accentColor="cyan" />);

        const trigger = screen.getByRole('button', { name: /Current waveform: sawtooth/i });
        await userEvent.click(trigger);

        // Check for popover content (e.g. one of the groups or buttons)
        expect(screen.getByText('BASIC')).toBeInTheDocument();
    });

    it('shows description on hover', async () => {
        const onChange = vi.fn();
        render(<WaveformSelector selected="sawtooth" onChange={onChange} accentColor="cyan" />);

        const trigger = screen.getByRole('button', { name: /Current waveform: sawtooth/i });
        await userEvent.click(trigger);

        const squareBtn = screen.getByRole('button', { name: 'Select square' });
        fireEvent.mouseEnter(squareBtn);

        expect(screen.getByText(/Standard Square/i)).toBeInTheDocument();
    });
});
