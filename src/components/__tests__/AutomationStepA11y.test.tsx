import { useRef } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { AutomationStep } from '../MainSequencer';
import type { TrackKey } from '../../types';

// Define props for TestWrapper based on AutomationStep props
interface AutomationStepProps {
    stepIndex: number;
    value: number;
    rowKey: TrackKey;
    rowLabel: string;
    onChange: (k: TrackKey, i: number, val: number) => void;
}

// Wrapper component to provide refs and SVG context
const TestWrapper = (props: AutomationStepProps) => {
    const refsArray = useRef<(SVGGElement | null)[]>([]);
    return (
        <svg>
            <AutomationStep {...props} refsArray={refsArray} />
        </svg>
    );
};

describe('AutomationStep Accessibility', () => {
    const defaultProps = {
        stepIndex: 0,
        value: 0.5,
        rowKey: 'partA' as TrackKey,
        rowLabel: 'Lead',
        onChange: vi.fn(),
    };

    it('renders with correct accessibility attributes', () => {
        render(<TestWrapper {...defaultProps} />);
        const slider = screen.getByRole('slider');

        expect(slider).toHaveAttribute('aria-label', 'Lead automation step 1, Active');
        expect(slider).toHaveAttribute('aria-valuenow', '50');
        expect(slider).toHaveAttribute('aria-valuetext', '50%');
        expect(slider).toHaveAttribute('tabindex', '0');
    });

    it('responds to keyboard interactions', () => {
        render(<TestWrapper {...defaultProps} />);
        const slider = screen.getByRole('slider');
        slider.focus();

        // Arrow Up -> Increment (Small Step)
        fireEvent.keyDown(slider, { key: 'ArrowUp' });
        expect(defaultProps.onChange).toHaveBeenCalledWith('partA', 0, expect.closeTo(0.55, 1));

        // Arrow Down -> Decrement (Small Step)
        fireEvent.keyDown(slider, { key: 'ArrowDown' });
        expect(defaultProps.onChange).toHaveBeenCalledWith('partA', 0, expect.closeTo(0.45, 1));

        // Page Up -> Large Increment
        fireEvent.keyDown(slider, { key: 'PageUp' });
        expect(defaultProps.onChange).toHaveBeenCalledWith('partA', 0, expect.closeTo(0.7, 1));

        // Page Down -> Large Decrement
        fireEvent.keyDown(slider, { key: 'PageDown' });
        expect(defaultProps.onChange).toHaveBeenCalledWith('partA', 0, expect.closeTo(0.3, 1));

        // Home -> Min
        fireEvent.keyDown(slider, { key: 'Home' });
        expect(defaultProps.onChange).toHaveBeenCalledWith('partA', 0, 0);

        // End -> Max
        fireEvent.keyDown(slider, { key: 'End' });
        expect(defaultProps.onChange).toHaveBeenCalledWith('partA', 0, 1);
    });
});
