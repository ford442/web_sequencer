import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { DragValue } from '../DragValue';

describe('DragValue Keyboard Navigation', () => {
    const defaultProps = {
        value: 50,
        onChange: vi.fn(),
        min: 0,
        max: 100,
        step: 1,
        label: 'Test Label'
    };

    it('renders with correct accessibility attributes', () => {
        render(<DragValue {...defaultProps} />);
        const slider = screen.getByRole('slider');
        expect(slider).toBeDefined();
        expect(slider.getAttribute('aria-valuemin')).toBe('0');
        expect(slider.getAttribute('aria-valuemax')).toBe('100');
        expect(slider.getAttribute('aria-valuenow')).toBe('50');
        expect(slider.getAttribute('aria-label')).toBe('Test Label');
    });

    it('handles ArrowUp and ArrowRight (increment)', () => {
        const onChange = vi.fn();
        render(<DragValue {...defaultProps} onChange={onChange} />);
        const slider = screen.getByRole('slider');

        fireEvent.keyDown(slider, { key: 'ArrowUp' });
        expect(onChange).toHaveBeenCalledWith(51);

        fireEvent.keyDown(slider, { key: 'ArrowRight' });
        expect(onChange).toHaveBeenCalledWith(51);
    });

    it('handles ArrowDown and ArrowLeft (decrement)', () => {
        const onChange = vi.fn();
        render(<DragValue {...defaultProps} onChange={onChange} />);
        const slider = screen.getByRole('slider');

        fireEvent.keyDown(slider, { key: 'ArrowDown' });
        expect(onChange).toHaveBeenCalledWith(49);

        fireEvent.keyDown(slider, { key: 'ArrowLeft' });
        expect(onChange).toHaveBeenCalledWith(49);
    });

    it('handles Shift + Arrow (coarse step x10)', () => {
        const onChange = vi.fn();
        render(<DragValue {...defaultProps} onChange={onChange} />);
        const slider = screen.getByRole('slider');

        fireEvent.keyDown(slider, { key: 'ArrowUp', shiftKey: true });
        expect(onChange).toHaveBeenCalledWith(60);

        fireEvent.keyDown(slider, { key: 'ArrowDown', shiftKey: true });
        expect(onChange).toHaveBeenCalledWith(40);
    });

    it('handles PageUp and PageDown (large step x5)', () => {
        const onChange = vi.fn();
        render(<DragValue {...defaultProps} onChange={onChange} />);
        const slider = screen.getByRole('slider');

        fireEvent.keyDown(slider, { key: 'PageUp' });
        expect(onChange).toHaveBeenCalledWith(55);

        fireEvent.keyDown(slider, { key: 'PageDown' });
        expect(onChange).toHaveBeenCalledWith(45);
    });

    it('handles Home and End (min/max)', () => {
        const onChange = vi.fn();
        render(<DragValue {...defaultProps} onChange={onChange} />);
        const slider = screen.getByRole('slider');

        fireEvent.keyDown(slider, { key: 'Home' });
        expect(onChange).toHaveBeenCalledWith(0);

        fireEvent.keyDown(slider, { key: 'End' });
        expect(onChange).toHaveBeenCalledWith(100);
    });

    it('handles keyboard activation on increment/decrement buttons', () => {
        const onChange = vi.fn();
        render(<DragValue {...defaultProps} onChange={onChange} />);

        const plusBtn = screen.getByLabelText('Increase Test Label');
        const minusBtn = screen.getByLabelText('Decrease Test Label');

        // Simulate Enter key on buttons (which fires click in browsers)
        // We use detail: 0 to simulate keyboard-triggered click
        plusBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));
        expect(onChange).toHaveBeenCalledWith(51);

        onChange.mockClear();
        minusBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));
        expect(onChange).toHaveBeenCalledWith(49);
    });
});
