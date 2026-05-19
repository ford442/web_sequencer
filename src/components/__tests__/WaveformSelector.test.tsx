import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { WaveformSelector } from '../WaveformSelector';
import userEvent from '@testing-library/user-event';

describe('WaveformSelector', () => {
    it('renders compact trigger button', () => {
        const onChange = vi.fn();
        render(<WaveformSelector selected="sawtooth" onChange={onChange} accentColor="cyan" />);

        const triggerBtn = screen.getByRole('button', { name: /Waveform selector: sawtooth/i });
        expect(triggerBtn).toBeInTheDocument();
        expect(triggerBtn).toHaveAttribute('aria-expanded', 'false');
    });

    it('expands panel on trigger button click', async () => {
        const onChange = vi.fn();
        render(<WaveformSelector selected="sawtooth" onChange={onChange} accentColor="cyan" />);

        const triggerBtn = screen.getByRole('button', { name: /Waveform selector: sawtooth/i });
        await userEvent.click(triggerBtn);

        // After expanding, the oscillator group labels should be visible
        expect(screen.getByText('JavaScript')).toBeInTheDocument();
        expect(screen.getByText('PCM')).toBeInTheDocument();
    });

    it('cycles through waveforms on double-click of trigger button', async () => {
        const onChange = vi.fn();
        render(<WaveformSelector selected="sawtooth" onChange={onChange} accentColor="cyan" />);

        const triggerBtn = screen.getByRole('button', { name: /Waveform selector: sawtooth/i });
        
        // Double-click should cycle to next waveform (sawtooth -> square)
        fireEvent.doubleClick(triggerBtn);
        expect(onChange).toHaveBeenCalledWith('square');
    });

    it('selects waveform from expanded panel', async () => {
        const onChange = vi.fn();
        render(<WaveformSelector selected="sawtooth" onChange={onChange} accentColor="cyan" />);

        // Expand the panel
        const triggerBtn = screen.getByRole('button', { name: /Waveform selector: sawtooth/i });
        await userEvent.click(triggerBtn);

        // Select square waveform
        const squareBtn = screen.getByRole('button', { name: /Select square waveform/ });
        await userEvent.click(squareBtn);

        expect(onChange).toHaveBeenCalledWith('square');
    });

    it('highlights selected waveform in panel', async () => {
        const onChange = vi.fn();
        render(<WaveformSelector selected="square" onChange={onChange} accentColor="cyan" />);

        // Expand the panel
        const triggerBtn = screen.getByRole('button', { name: /Waveform selector: square/i });
        await userEvent.click(triggerBtn);

        const squareBtn = screen.getByRole('button', { name: /Select square waveform \(currently selected\)/ });
        expect(squareBtn).toHaveAttribute('aria-pressed', 'true');
        expect(squareBtn).toHaveAttribute('aria-current', 'true');
    });
});
