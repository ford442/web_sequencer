import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { WaveformSelector } from '../WaveformSelector';
import userEvent from '@testing-library/user-event';

describe('WaveformSelector', () => {
    it('renders all waveform buttons', () => {
        const onChange = vi.fn();
        render(<WaveformSelector selected="sawtooth" onChange={onChange} accentColor="cyan" />);

        // Check for oscillator group labels
        expect(screen.getByText('JavaScript')).toBeInTheDocument();
        expect(screen.getByText('PCM')).toBeInTheDocument();
        expect(screen.getByText('Open303')).toBeInTheDocument();
        expect(screen.getByText('Pyodide')).toBeInTheDocument();
        expect(screen.getByText('Rust')).toBeInTheDocument();
        expect(screen.getByText('WebGPU')).toBeInTheDocument();
        expect(screen.getByText('Web Audio Module')).toBeInTheDocument();
    });

    it('cycles through waveforms on main button click', async () => {
        const onChange = vi.fn();
        render(<WaveformSelector selected="sawtooth" onChange={onChange} accentColor="cyan" />);

        const trigger = screen.getByRole('button', { name: /Current waveform: sawtooth\. Click to cycle/i });
        
        // Click should cycle to next waveform (sawtooth -> square)
        await userEvent.click(trigger);
        expect(onChange).toHaveBeenCalledWith('square');
    });

    it('cycles through all basic waveforms in order', async () => {
        const onChange = vi.fn();
        const { rerender } = render(<WaveformSelector selected="sawtooth" onChange={onChange} accentColor="cyan" />);

        // sawtooth -> square
        const trigger = screen.getByRole('button', { name: /Current waveform: sawtooth\. Click to cycle/i });
        await userEvent.click(trigger);
        expect(onChange).toHaveBeenCalledWith('square');

        // square -> triangle
        rerender(<WaveformSelector selected="square" onChange={onChange} accentColor="cyan" />);
        const trigger2 = screen.getByRole('button', { name: /Current waveform: square\. Click to cycle/i });
        await userEvent.click(trigger2);
        expect(onChange).toHaveBeenCalledWith('triangle');

        // triangle -> sine
        rerender(<WaveformSelector selected="triangle" onChange={onChange} accentColor="cyan" />);
        const trigger3 = screen.getByRole('button', { name: /Current waveform: triangle\. Click to cycle/i });
        await userEvent.click(trigger3);
        expect(onChange).toHaveBeenCalledWith('sine');

        // sine -> wav-saw (continues into next group)
        rerender(<WaveformSelector selected="sine" onChange={onChange} accentColor="cyan" />);
        const trigger4 = screen.getByRole('button', { name: /Current waveform: sine\. Click to cycle/i });
        await userEvent.click(trigger4);
        expect(onChange).toHaveBeenCalledWith('wav-saw');
    });

    it('selects waveform on button click', async () => {
        const onChange = vi.fn();
        render(<WaveformSelector selected="sawtooth" onChange={onChange} accentColor="cyan" />);

        const squareBtn = screen.getByRole('button', { name: /Select square waveform/i });
        await userEvent.click(squareBtn);

        expect(onChange).toHaveBeenCalledWith('square');
    });

    it('highlights selected waveform', () => {
        const onChange = vi.fn();
        render(<WaveformSelector selected="square" onChange={onChange} accentColor="cyan" />);

        const squareBtn = screen.getByRole('button', { name: /Select square waveform/i });
        expect(squareBtn).toHaveAttribute('aria-pressed', 'true');
        expect(squareBtn).toHaveAttribute('aria-current', 'true');
    });
});
