// src/__tests__/NoteSelector.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { NoteSelector } from '../components/NoteSelector';

// Mock getNoteColor since it's used in the component
const getNoteColor = vi.fn((_note) => '#ff0000');

describe('NoteSelector', () => {
    beforeAll(() => {
        vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
            cb(0);
            return 0;
        });
    });

    afterAll(() => {
        vi.restoreAllMocks();
    });

    const defaultProps = {
        x: 100,
        y: 100,
        trackType: 'synth' as const,
        currentNote: 'C4',
        onSelect: vi.fn(),
        onClose: vi.fn(),
        getNoteColor: getNoteColor,
        currentLength: 1,
        onLengthChange: vi.fn(),
    };

    it('renders with accessibility roles and labels', () => {
        render(<NoteSelector {...defaultProps} />);

        // Container should have dialog role
        const dialog = screen.getByRole('dialog');
        expect(dialog).toBeInTheDocument();
        expect(dialog).toHaveAttribute('aria-modal', 'true');
        expect(dialog).toHaveAttribute('aria-labelledby', 'note-selector-title');

        // Close button should have aria-label
        const closeButton = screen.getByRole('button', { name: 'Close note properties' });
        expect(closeButton).toBeInTheDocument();

        // Note buttons should have specific aria-labels
        // NOTES are reversed in component: B, A#, A, G#, G, F#, F, E, D#, D, C#, C
        // Octaves: 2, 3, 4 (for synth)

        // Check for specific note buttons
        expect(screen.getByRole('button', { name: 'Select C4' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Select C#4' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Select B2' })).toBeInTheDocument();
    });

    it('displays the correct octaves for synth track type', () => {
        render(<NoteSelector {...defaultProps} trackType="synth" />);
        // Synth has octaves 2, 3, 4
        expect(screen.getByText('OCT 2')).toBeInTheDocument();
        expect(screen.getByText('OCT 3')).toBeInTheDocument();
        expect(screen.getByText('OCT 4')).toBeInTheDocument();
    });

    it('displays the correct octaves for drum track type', () => {
        render(<NoteSelector {...defaultProps} trackType="drum" />);
        // Drum has octave 2
        expect(screen.getByText('OCT 2')).toBeInTheDocument();
        expect(screen.queryByText('OCT 3')).not.toBeInTheDocument();
    });

    it('closes on Escape key press', () => {
        const onClose = vi.fn();
        render(<NoteSelector {...defaultProps} onClose={onClose} />);

        fireEvent.keyDown(window, { key: 'Escape' });
        expect(onClose).toHaveBeenCalled();
    });

    it('focuses the close button on mount', async () => {
        render(<NoteSelector {...defaultProps} />);
        const closeButton = screen.getByRole('button', { name: 'Close note properties' });
        await waitFor(() => {
            expect(document.activeElement).toBe(closeButton);
        });
    });

    it('renders advanced property controls with accessible labels', () => {
        const onPropertyChange = vi.fn();
        render(
            <NoteSelector
                {...defaultProps}
                onPropertyChange={onPropertyChange}
                currentTimbre={0.75}
                currentProbability={0.5}
                currentMicrotiming={-0.15}
                currentRetrigger={2}
            />
        );

        // Check Expression (Timbre) input
        const timbreInput = screen.getByLabelText('Expression');
        expect(timbreInput).toHaveAttribute('type', 'range');
        expect(timbreInput).toHaveAttribute('aria-valuetext', '75%');

        // Check Probability input
        const probInput = screen.getByLabelText('Probability');
        expect(probInput).toHaveAttribute('type', 'range');
        expect(probInput).toHaveAttribute('aria-valuetext', '50%');

        // Check Microtiming input
        const microInput = screen.getByLabelText('Microtiming');
        expect(microInput).toHaveAttribute('type', 'range');
        expect(microInput).toHaveAttribute('aria-valuetext', '-0.15 steps');

        // Check Retrigger group
        const retriggerGroup = screen.getByRole('group', { name: 'Retrigger' });
        expect(retriggerGroup).toBeInTheDocument();

        // Check Retrigger buttons
        const retrigger2x = screen.getByRole('button', { name: 'Retrigger 2 times' });
        expect(retrigger2x).toHaveAttribute('aria-pressed', 'true');

        const retrigger1x = screen.getByRole('button', { name: 'No retrigger' });
        expect(retrigger1x).toHaveAttribute('aria-pressed', 'false');
    });
});
