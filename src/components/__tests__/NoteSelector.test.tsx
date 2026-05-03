import { render, screen, fireEvent } from '@testing-library/react';
import { NoteSelector } from '../NoteSelector';
import '@testing-library/jest-dom';
import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

// Mock focus trap hook if necessary, but we want to test the real hook logic.
// However, JSDOM has limitations with focus and layout.
// We need to mock requestAnimationFrame to be synchronous for the hook to work immediately.

describe('NoteSelector', () => {
    beforeAll(() => {
        vi.useFakeTimers();
        // Mock requestAnimationFrame to execute callback immediately
        vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
            cb(0);
            return 0;
        });
    });

    afterAll(() => {
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    const mockOnSelect = vi.fn();
    const mockOnLengthChange = vi.fn();
    const mockOnClose = vi.fn();
    const mockGetNoteColor = vi.fn().mockReturnValue('#ffffff');
    const mockOnPropertyChange = vi.fn();

    const defaultProps = {
        x: 100,
        y: 100,
        trackType: 'synth' as const,
        currentNote: 'C4',
        currentLength: 1,
        onSelect: mockOnSelect,
        onLengthChange: mockOnLengthChange,
        onClose: mockOnClose,
        getNoteColor: mockGetNoteColor,
        currentTimbre: 0.5,
        currentProbability: 1.0,
        currentMicrotiming: 0,
        currentReverse: false,
        currentRetrigger: 1,
        onPropertyChange: mockOnPropertyChange,
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders correctly', () => {
        render(<NoteSelector {...defaultProps} />);
        expect(screen.getByRole('dialog')).toBeInTheDocument();
        expect(screen.getByText('NOTE PROPERTIES')).toBeInTheDocument();
        // Check for some controls
        expect(screen.getByLabelText('Duration')).toBeInTheDocument();
        expect(screen.getByLabelText('Expression')).toBeInTheDocument();
    });

    it('renders granular pitch quantization control for synth tracks', () => {
        render(<NoteSelector {...defaultProps} trackType="synth" currentGrainPitchQuantize={7} />);
        const quantSlider = screen.getByLabelText('Granular Pitch Quantization');
        expect(quantSlider).toBeInTheDocument();
        expect(quantSlider).toHaveValue('7');

        fireEvent.change(quantSlider, { target: { value: '12' } });
        expect(mockOnPropertyChange).toHaveBeenCalledWith('grainPitchQuantize', 12);
    });

    it('traps focus inside the dialog', () => {
        render(<NoteSelector {...defaultProps} />);
        const dialog = screen.getByRole('dialog');

        // Initial focus should be on the first focusable element (Close button usually)
        expect(dialog.contains(document.activeElement)).toBe(true);

        // Find focusable elements
        const closeButton = screen.getByLabelText('Close');

        // Find last element (a note button)
        const noteButtons = screen.getAllByRole('button', { name: /Select/ });
        const lastNoteButton = noteButtons[noteButtons.length - 1];

        lastNoteButton.focus();
        expect(document.activeElement).toBe(lastNoteButton);

        // Simulate Tab on last element
        fireEvent.keyDown(window, { key: 'Tab' });

        // Should wrap to first element (Close button)
        expect(document.activeElement).toBe(closeButton);

        // Simulate Shift+Tab on first element
        closeButton.focus();
        fireEvent.keyDown(window, { key: 'Tab', shiftKey: true });

        // Should wrap to last element
        expect(document.activeElement).toBe(lastNoteButton);
    });

    it('calls onClose when Escape is pressed', () => {
        render(<NoteSelector {...defaultProps} />);
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(mockOnClose).toHaveBeenCalled();
    });

    it('restores focus on unmount', () => {
        // Create a button to hold initial focus
        const outerButton = document.createElement('button');
        document.body.appendChild(outerButton);
        outerButton.focus();

        const { unmount } = render(<NoteSelector {...defaultProps} />);

        // Verify focus moved into dialog
        expect(document.activeElement).not.toBe(outerButton);

        unmount();

        // Verify focus returned (hook uses setTimeout 0)
        vi.runAllTimers();

        expect(document.activeElement).toBe(outerButton);

        // Cleanup
        document.body.removeChild(outerButton);
    });
});
