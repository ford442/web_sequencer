import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AdvancedNoteSelector } from '../AdvancedNoteSelector';

describe('AdvancedNoteSelector', () => {
    const defaultProps = {
        value: 'C4',
        onChange: vi.fn(),
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    // --- Rendering ---
    it('renders with the current note displayed', () => {
        render(<AdvancedNoteSelector {...defaultProps} value="E4" />);
        const button = screen.getByRole('button', { name: /Note E4/ });
        expect(button).toBeInTheDocument();
        expect(button).toHaveTextContent('E4');
    });

    it('renders with custom label', () => {
        render(<AdvancedNoteSelector {...defaultProps} label="Lead note" />);
        expect(screen.getByRole('button', { name: 'Lead note' })).toBeInTheDocument();
    });

    it('has correct aria attributes', () => {
        render(<AdvancedNoteSelector {...defaultProps} />);
        const button = screen.getByRole('button', { name: /Note C4/ });
        expect(button).toHaveAttribute('aria-haspopup', 'true');
        expect(button).toHaveAttribute('aria-expanded', 'false');
    });

    // --- Click to open flyout ---
    it('opens flyout on click (no drag)', () => {
        render(<AdvancedNoteSelector {...defaultProps} />);
        const button = screen.getByRole('button', { name: /Note C4/ });

        // Simulate pointer down + up without move (click)
        fireEvent.pointerDown(button, { button: 0, clientY: 100, pointerId: 1 });
        fireEvent.pointerUp(button, { pointerId: 1 });

        expect(button).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByRole('listbox', { name: 'Note picker' })).toBeInTheDocument();
    });

    it('closes flyout when clicking backdrop', () => {
        render(<AdvancedNoteSelector {...defaultProps} />);
        const button = screen.getByRole('button', { name: /Note C4/ });

        // Open flyout
        fireEvent.pointerDown(button, { button: 0, clientY: 100, pointerId: 1 });
        fireEvent.pointerUp(button, { pointerId: 1 });

        expect(screen.getByRole('listbox')).toBeInTheDocument();

        // Click backdrop (the fixed overlay)
        const backdrop = document.querySelector('.fixed.inset-0.z-40');
        expect(backdrop).toBeTruthy();
        fireEvent.click(backdrop!);

        expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });

    // --- Flyout note selection ---
    it('selects a note from the flyout', () => {
        const onChange = vi.fn();
        render(<AdvancedNoteSelector {...defaultProps} onChange={onChange} />);
        const button = screen.getByRole('button', { name: /Note C4/ });

        // Open flyout
        fireEvent.pointerDown(button, { button: 0, clientY: 100, pointerId: 1 });
        fireEvent.pointerUp(button, { pointerId: 1 });

        // Find and click a note option
        const eOption = screen.getAllByRole('option').find(el => el.textContent === 'E' && el.getAttribute('aria-selected') === 'false');
        expect(eOption).toBeTruthy();
        fireEvent.click(eOption!);

        expect(onChange).toHaveBeenCalled();
        // Flyout should close after selection
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });

    it('highlights the currently selected note in the flyout', () => {
        render(<AdvancedNoteSelector {...defaultProps} value="C4" />);
        const button = screen.getByRole('button', { name: /Note C4/ });

        // Open flyout
        fireEvent.pointerDown(button, { button: 0, clientY: 100, pointerId: 1 });
        fireEvent.pointerUp(button, { pointerId: 1 });

        // Find the selected option
        const selectedOptions = screen.getAllByRole('option', { selected: true });
        expect(selectedOptions.length).toBeGreaterThan(0);
    });

    // --- Flyout octave rendering ---
    it('renders piano keys organized by octave', () => {
        render(<AdvancedNoteSelector {...defaultProps} minMidi={48} maxMidi={72} />);
        const button = screen.getByRole('button', { name: /Note C4/ });

        // Open flyout
        fireEvent.pointerDown(button, { button: 0, clientY: 100, pointerId: 1 });
        fireEvent.pointerUp(button, { pointerId: 1 });

        // Should have octave labels
        expect(screen.getByText('3')).toBeInTheDocument();
        expect(screen.getByText('4')).toBeInTheDocument();
    });

    // --- Scale filtering in flyout ---
    it('greys out non-scale notes in flyout when currentScale is set', () => {
        render(
            <AdvancedNoteSelector
                {...defaultProps}
                currentScale={{ root: 'C', scale: 'Major' }}
            />
        );
        const button = screen.getByRole('button', { name: /Note C4/ });

        // Open flyout
        fireEvent.pointerDown(button, { button: 0, clientY: 100, pointerId: 1 });
        fireEvent.pointerUp(button, { pointerId: 1 });

        // C Major scale: C D E F G A B — sharps are out of scale
        // Find a C# option — should be disabled
        const options = screen.getAllByRole('option');
        const sharpOptions = options.filter(el => el.textContent === 'C#');
        sharpOptions.forEach(opt => {
            expect(opt).toHaveAttribute('aria-disabled', 'true');
        });

        // Find a C option — should not be disabled
        const cOptions = options.filter(el => el.textContent === 'C');
        cOptions.forEach(opt => {
            expect(opt).toHaveAttribute('aria-disabled', 'false');
        });
    });

    it('does not call onChange when clicking a disabled (out-of-scale) note', () => {
        const onChange = vi.fn();
        render(
            <AdvancedNoteSelector
                {...defaultProps}
                onChange={onChange}
                currentScale={{ root: 'C', scale: 'Major' }}
            />
        );
        const button = screen.getByRole('button', { name: /Note C4/ });

        // Open flyout
        fireEvent.pointerDown(button, { button: 0, clientY: 100, pointerId: 1 });
        fireEvent.pointerUp(button, { pointerId: 1 });

        // Click a disabled note (C#)
        const options = screen.getAllByRole('option');
        const sharpOption = options.find(el => el.textContent === 'C#');
        expect(sharpOption).toBeTruthy();
        fireEvent.click(sharpOption!);

        expect(onChange).not.toHaveBeenCalled();
    });

    // --- Right-click should not activate ---
    it('ignores right-click on the button', () => {
        render(<AdvancedNoteSelector {...defaultProps} />);
        const button = screen.getByRole('button', { name: /Note C4/ });

        fireEvent.pointerDown(button, { button: 2, clientY: 100, pointerId: 1 });
        fireEvent.pointerUp(button, { pointerId: 1 });

        // Flyout should NOT open
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });
});
