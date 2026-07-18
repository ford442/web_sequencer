import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useKnobInteraction } from '../useKnobInteraction';

describe('useKnobInteraction', () => {
    it('prefers automated normalized value for display', () => {
        const onChange = vi.fn();
        const { result, rerender } = renderHook(
            (props) => useKnobInteraction(props),
            {
                initialProps: {
                    value: 0.2,
                    min: 0,
                    max: 1,
                    onChange,
                    isAutomated: true,
                    automatedValue: 0.8,
                },
            }
        );

        expect(result.current.displayValue).toBeCloseTo(0.8, 5);

        rerender({
            value: 0.2,
            min: 0,
            max: 1,
            onChange,
            isAutomated: true,
            automatedValue: 0.35,
        });

        expect(result.current.displayValue).toBeCloseTo(0.35, 5);
    });

    it('exposes automation aria metadata', () => {
        const onChange = vi.fn();
        const { result } = renderHook(() =>
            useKnobInteraction({
                value: 50,
                min: 0,
                max: 100,
                onChange,
                label: 'Level',
                isAutomated: true,
                automatedValue: 0.5,
            })
        );

        expect(result.current.interactionProps['aria-label']).toBe('Level (automated)');
        expect(result.current.interactionProps['aria-description']).toContain('automation lane');
    });
});
