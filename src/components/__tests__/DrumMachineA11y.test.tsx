import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { DrumMachine } from '../DrumMachine';
import { AllDrumParams } from '../../types';

const mockParams: AllDrumParams = {
    kick: { pitch: 50, decay: 0.5, tone: 0.5, volume: 1.0 },
    snare: { decay: 0.2, tone: 200, noise: 5000, volume: 1.0 },
    closedHat: { decay: 0.05, pitch: 8000, volume: 1.0 },
    openHat: { decay: 0.5, pitch: 8000, volume: 1.0 },
};

describe('DrumMachine Accessibility', () => {
    it('Drum kit selection buttons have proper ARIA attributes, focus styles, and titles', () => {
        render(
            <DrumMachine
                params={mockParams}
                onParamsChange={vi.fn()}
                drumKit="808"
                onDrumKitChange={vi.fn()}
            />
        );

        const kit808 = screen.getByRole('radio', { name: /TR-808 Kit/i });
        const kit909 = screen.getByRole('radio', { name: /TR-909 Kit/i });

        expect(kit808).toBeInTheDocument();
        expect(kit808).toHaveAttribute('aria-checked', 'true');
        expect(kit808).toHaveAttribute('title', 'Switch to TR-808 Kit');
        expect(kit808).toHaveClass('focus-visible:ring-2');

        expect(kit909).toBeInTheDocument();
        expect(kit909).toHaveAttribute('aria-checked', 'false');
        expect(kit909).toHaveAttribute('title', 'Switch to TR-909 Kit');
        expect(kit909).toHaveClass('focus-visible:ring-2');
    });
});
