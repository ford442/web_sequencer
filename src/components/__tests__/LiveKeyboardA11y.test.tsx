import { render, fireEvent, screen, act } from '@testing-library/react';
import { LiveKeyboard } from '../LiveKeyboard';
import { vi } from 'vitest';

describe('LiveKeyboard Accessibility', () => {
    test('opens KeyboardGuide with correct ARIA attributes and focus management', async () => {
        const onPlay = vi.fn();
        const onStop = vi.fn();
        render(<LiveKeyboard onPlayNote={onPlay} onStopNote={onStop} activeTrackColor="#ffffff" />);

        // 1. Open the guide
        const openButton = screen.getByTitle('Show Keyboard Layout Guide');
        fireEvent.click(openButton);

        // 2. Check for Dialog Role
        const dialog = screen.getByRole('dialog');
        expect(dialog).toBeInTheDocument();
        expect(dialog).toHaveAttribute('aria-modal', 'true');
        expect(dialog).toHaveAttribute('aria-labelledby', 'keyboard-guide-title');

        // 3. Check for Title ID matching aria-labelledby
        const title = screen.getByText('FLIPPED MODE');
        expect(title).toHaveAttribute('id', 'keyboard-guide-title');

        // 4. Verify Initial Focus on "GOT IT" button
        const gotItButton = screen.getByText('GOT IT');
        // Wait for useEffect to fire
        await new Promise(r => setTimeout(r, 0));
        expect(document.activeElement).toBe(gotItButton);

        // 5. Close with Escape
        fireEvent.keyDown(window, { key: 'Escape' });

        // 6. Verify Dialog is gone
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
});
