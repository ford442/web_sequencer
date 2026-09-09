import { render, fireEvent, screen } from '@testing-library/react';
import { LiveKeyboard } from '../LiveKeyboard';
import { vi } from 'vitest';
import {
    MIN_KEYBOARD_OCTAVE,
    MAX_KEYBOARD_OCTAVE,
    DEFAULT_KEYBOARD_OCTAVE,
} from '../../utils/keyboardOctave';

const renderKeyboard = () => render(
    <LiveKeyboard onPlayNote={vi.fn()} onStopNote={vi.fn()} activeTrackColor="#ffffff" />
);

describe('LiveKeyboard Accessibility', () => {
    beforeEach(() => {
        localStorage.clear();
    });
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
        const title = screen.getByText('PIANO KEYBOARD');
        expect(title).toHaveAttribute('id', 'keyboard-guide-title');

        // 4. Verify Initial Focus
        const closeButton = screen.getByLabelText('Close guide');
        // Wait for useEffect to fire
        await new Promise(r => setTimeout(r, 0));
        expect(document.activeElement).toBe(closeButton);

        // 5. Close with Escape
        fireEvent.keyDown(window, { key: 'Escape' });

        // 6. Verify Dialog is gone
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    describe('octave controls', () => {
        test('exposes accessible names and a readable current-octave readout', () => {
            renderKeyboard();

            expect(screen.getByRole('button', { name: 'Octave down' })).toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'Octave up' })).toBeInTheDocument();
            expect(screen.getByText(`OCT ${DEFAULT_KEYBOARD_OCTAVE}`)).toBeInTheDocument();
        });

        test('announces the octave and its key span to screen readers', () => {
            renderKeyboard();

            const status = screen.getByRole('status');
            expect(status).toHaveAttribute('aria-live', 'polite');
            expect(status).toHaveTextContent(
                `Octave ${DEFAULT_KEYBOARD_OCTAVE}, keys C${DEFAULT_KEYBOARD_OCTAVE} to C${DEFAULT_KEYBOARD_OCTAVE + 1}`
            );
        });

        test('both controls are enabled at the center of the range', () => {
            renderKeyboard();

            expect(screen.getByRole('button', { name: 'Octave down' })).toBeEnabled();
            expect(screen.getByRole('button', { name: 'Octave up' })).toBeEnabled();
        });

        test('disables the down control at the bottom of the range', () => {
            renderKeyboard();
            const down = screen.getByRole('button', { name: 'Octave down' });

            for (let i = 0; i < DEFAULT_KEYBOARD_OCTAVE - MIN_KEYBOARD_OCTAVE; i++) {
                fireEvent.click(down);
            }

            expect(screen.getByText(`OCT ${MIN_KEYBOARD_OCTAVE}`)).toBeInTheDocument();
            expect(down).toBeDisabled();
            expect(screen.getByRole('button', { name: 'Octave up' })).toBeEnabled();
        });

        test('disables the up control at the top of the range', () => {
            renderKeyboard();
            const up = screen.getByRole('button', { name: 'Octave up' });

            for (let i = 0; i < MAX_KEYBOARD_OCTAVE - DEFAULT_KEYBOARD_OCTAVE; i++) {
                fireEvent.click(up);
            }

            expect(screen.getByText(`OCT ${MAX_KEYBOARD_OCTAVE}`)).toBeInTheDocument();
            expect(up).toBeDisabled();
            expect(screen.getByRole('button', { name: 'Octave down' })).toBeEnabled();
        });
    });
});
