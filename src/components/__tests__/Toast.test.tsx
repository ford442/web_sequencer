import { render, screen, act } from '@testing-library/react';
import { Toast } from '../Toast';
import { vi, describe, it, expect } from 'vitest';

describe('Toast', () => {
    it('renders the message', () => {
        render(<Toast message="Hello World" type="success" onClose={() => {}} />);
        expect(screen.getByText('Hello World')).toBeDefined();
    });

    it('renders success icon', () => {
        render(<Toast message="Success" type="success" onClose={() => {}} />);
        expect(screen.getByText('✓')).toBeDefined();
    });

    it('renders error icon', () => {
        render(<Toast message="Error" type="error" onClose={() => {}} />);
        expect(screen.getByText('⚠')).toBeDefined();
    });

    it('calls onClose after timeout', () => {
        vi.useFakeTimers();
        const onClose = vi.fn();
        render(<Toast message="Auto Close" type="success" onClose={onClose} />);

        expect(onClose).not.toHaveBeenCalled();

        act(() => {
            vi.advanceTimersByTime(3000);
        });

        expect(onClose).toHaveBeenCalled();
        vi.useRealTimers();
    });
});
