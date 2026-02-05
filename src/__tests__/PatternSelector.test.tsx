import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PatternSelector } from '../components/PatternSelector';

describe('PatternSelector', () => {
    const defaultProps = {
        x: 100,
        y: 100,
        currentPattern: 0,
        onSelect: vi.fn(),
        onClose: vi.fn(),
    };

    it('renders with accessibility roles and labels', () => {
        render(<PatternSelector {...defaultProps} />);
        const dialog = screen.getByRole('dialog');
        expect(dialog).toBeInTheDocument();
        expect(dialog).toHaveAttribute('aria-modal', 'true');
        expect(dialog).toHaveAttribute('aria-labelledby', 'pattern-selector-title');
    });

    it('focuses the dialog on mount', () => {
        render(<PatternSelector {...defaultProps} />);
        const dialog = screen.getByRole('dialog');
        expect(document.activeElement).toBe(dialog);
    });

    it('closes on Escape key press', () => {
        const onClose = vi.fn();
        render(<PatternSelector {...defaultProps} onClose={onClose} />);
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(onClose).toHaveBeenCalled();
    });

    it('calls onSelect when a pattern is clicked', () => {
        const onSelect = vi.fn();
        render(<PatternSelector {...defaultProps} onSelect={onSelect} />);
        const patternBtn = screen.getByLabelText('Select Pattern 1');
        fireEvent.click(patternBtn);
        expect(onSelect).toHaveBeenCalledWith(0);
    });

     it('calls onSelect(null) when CLEAR is clicked', () => {
        const onSelect = vi.fn();
        render(<PatternSelector {...defaultProps} onSelect={onSelect} />);
        const clearBtn = screen.getByRole('button', { name: /clear/i });
        fireEvent.click(clearBtn);
        expect(onSelect).toHaveBeenCalledWith(null);
    });
});
