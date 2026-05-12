import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PatternSelector } from '../PatternSelector';

describe('PatternSelector', () => {
    const defaultProps = {
        x: 100,
        y: 100,
        currentPattern: 2,
        onSelect: vi.fn(),
        onClose: vi.fn(),
    };

    it('renders all 8 pattern buttons and a clear button', () => {
        render(<PatternSelector {...defaultProps} />);
        for (let i = 1; i <= 8; i++) {
            expect(screen.getByRole('radio', { name: `Pattern ${i}` })).toBeInTheDocument();
        }
        expect(screen.getByRole('button', { name: /Clear pattern from step/i })).toBeInTheDocument();
    });

    it('highlights the currently selected pattern', () => {
        render(<PatternSelector {...defaultProps} />);
        const selected = screen.getByRole('radio', { name: 'Pattern 3' });
        expect(selected).toHaveAttribute('aria-checked', 'true');
    });

    it('calls onSelect with the slot index when a pattern is clicked', () => {
        render(<PatternSelector {...defaultProps} />);
        const btn = screen.getByRole('radio', { name: 'Pattern 5' });
        fireEvent.click(btn);
        expect(defaultProps.onSelect).toHaveBeenCalledWith(4);
    });

    it('calls onClose when the close button is clicked', () => {
        render(<PatternSelector {...defaultProps} />);
        const closeBtn = screen.getByRole('button', { name: /Close pattern selector/i });
        fireEvent.click(closeBtn);
        expect(defaultProps.onClose).toHaveBeenCalled();
    });

    it('calls onSelect(null) when clear is clicked', () => {
        render(<PatternSelector {...defaultProps} />);
        const clearBtn = screen.getByRole('button', { name: /Clear pattern from step/i });
        fireEvent.click(clearBtn);
        expect(defaultProps.onSelect).toHaveBeenCalledWith(null);
    });

    it('calls onClose when the backdrop is clicked', () => {
        render(<PatternSelector {...defaultProps} />);
        // The backdrop is the first div with the fixed inset class
        const backdrop = document.querySelector('.fixed.inset-0');
        expect(backdrop).not.toBeNull();
        fireEvent.click(backdrop!);
        expect(defaultProps.onClose).toHaveBeenCalled();
    });
});
