import { render, screen, fireEvent } from '@testing-library/react';
import { LyricMapper } from '../LyricMapper';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock requestAnimationFrame for useFocusTrap
beforeEach(() => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
        cb(0);
        return 0;
    });
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('LyricMapper', () => {
    const defaultProps = {
        isOpen: true,
        onClose: vi.fn(),
        onApply: vi.fn(),
        initialText: 'Hello World',
        isGenerating: false,
        hasSelection: true,
    };

    it('renders when open', () => {
        render(<LyricMapper {...defaultProps} />);
        expect(screen.getByRole('dialog', { name: 'LYRIC MAPPER' })).toBeDefined();
        expect(screen.getByRole('textbox', { name: 'Lyrics Input' })).toBeDefined();
    });

    it('does not render when closed', () => {
        render(<LyricMapper {...defaultProps} isOpen={false} />);
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('updates text input', () => {
        render(<LyricMapper {...defaultProps} />);
        const textarea = screen.getByRole('textbox', { name: 'Lyrics Input' }) as HTMLTextAreaElement;

        expect(textarea.value).toBe('Hello World');

        fireEvent.change(textarea, { target: { value: 'New Lyrics' } });
        expect(textarea.value).toBe('New Lyrics');
    });

    it('calls onApply with false when "Generate Only" is clicked', () => {
        const onApply = vi.fn();
        render(<LyricMapper {...defaultProps} onApply={onApply} />);

        fireEvent.click(screen.getByText('GENERATE ONLY'));
        expect(onApply).toHaveBeenCalledWith('Hello World', false);
    });

    it('calls onApply with true when "Generate & Map" is clicked', () => {
        const onApply = vi.fn();
        render(<LyricMapper {...defaultProps} onApply={onApply} />);

        fireEvent.click(screen.getByText('GENERATE & MAP'));
        expect(onApply).toHaveBeenCalledWith('Hello World', true);
    });

    it('disables "Generate & Map" if no selection', () => {
        render(<LyricMapper {...defaultProps} hasSelection={false} />);
        const mapBtn = screen.getByText('GENERATE & MAP') as HTMLButtonElement;
        expect(mapBtn.disabled).toBe(true);
    });

    it('disables buttons when generating', () => {
        render(<LyricMapper {...defaultProps} isGenerating={true} />);
        const genBtn = screen.getByText('GENERATING...') as HTMLButtonElement;
        const mapBtn = screen.getByText('GENERATE & MAP') as HTMLButtonElement;

        expect(genBtn.disabled).toBe(true);
        expect(mapBtn.disabled).toBe(true);
    });
});
