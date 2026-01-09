// src/__tests__/NoteSelector.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NoteSelector } from '../components/NoteSelector';

// Mock getNoteColor since it's used in the component
const getNoteColor = vi.fn((_note) => '#ff0000');

describe('NoteSelector', () => {
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
        const closeButton = screen.getByRole('button', { name: 'Close' });
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
});
