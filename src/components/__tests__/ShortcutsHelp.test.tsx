import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ShortcutsHelp } from '../ShortcutsHelp';

describe('ShortcutsHelp', () => {
    it('renders the shortcuts modal', () => {
        render(<ShortcutsHelp onClose={() => {}} />);
        expect(screen.getByRole('dialog')).toBeInTheDocument();
        expect(screen.getByText('KEYBOARD SHORTCUTS')).toBeInTheDocument();
        expect(screen.getByText('Global')).toBeInTheDocument();
        expect(screen.getByText('Sequencer')).toBeInTheDocument();
    });

    it('calls onClose when close button is clicked', () => {
        const onClose = vi.fn();
        render(<ShortcutsHelp onClose={onClose} />);

        const closeBtn = screen.getByLabelText('Close Shortcuts');
        fireEvent.click(closeBtn);

        expect(onClose).toHaveBeenCalled();
    });

    it('calls onClose when Escape is pressed', () => {
        const onClose = vi.fn();
        render(<ShortcutsHelp onClose={onClose} />);

        fireEvent.keyDown(window, { key: 'Escape' });

        expect(onClose).toHaveBeenCalled();
    });
});
