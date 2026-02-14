import { render, screen, fireEvent } from '@testing-library/react';
import { ShortcutsHelp } from '../ShortcutsHelp';
import { describe, it, expect, vi } from 'vitest';

describe('ShortcutsHelp', () => {
    it('renders correctly', () => {
        render(<ShortcutsHelp onClose={() => {}} />);
        expect(screen.getByRole('dialog')).toBeInTheDocument();
        expect(screen.getByText('KEYBOARD SHORTCUTS')).toBeInTheDocument();
        expect(screen.getByText('Sequencer Grid')).toBeInTheDocument();
    });

    it('calls onClose when close button is clicked', () => {
        const onClose = vi.fn();
        render(<ShortcutsHelp onClose={onClose} />);
        fireEvent.click(screen.getByLabelText('Close Shortcuts Help'));
        expect(onClose).toHaveBeenCalled();
    });
});
