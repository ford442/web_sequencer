import React from 'react';
import { render, fireEvent, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { Sequencer } from '../components/Sequencer';
import { NUM_STEPS } from '../constants';
import type { Pattern } from '../types';

describe('Sequencer Rubber-Band Selection', () => {
    const mockPattern: Pattern = {
        partA: { steps: Array(NUM_STEPS).fill(null) },
        partB: { steps: Array(NUM_STEPS).fill(null) },
        kick: { steps: Array(NUM_STEPS).fill(null) },
        snare: { steps: Array(NUM_STEPS).fill(null) },
        closedHat: { steps: Array(NUM_STEPS).fill(null) },
        openHat: { steps: Array(NUM_STEPS).fill(null) },
        sampler: Array(8).fill({ steps: Array(NUM_STEPS).fill(null) }),
    };

    const defaultProps = {
        pattern: mockPattern,
        currentStep: 0,
        isPlaying: false,
        onPatternChange: vi.fn(),
        activeSamplerBank: 0,
    };

    it('should select a range of steps when Shift+Clicking and Dragging', () => {
        const onPatternChange = vi.fn();
        render(<Sequencer {...defaultProps} onPatternChange={onPatternChange} />);

        // Find steps in Synth A (partA)
        // StepButton label is `${label} step ${i + 1}`
        // Label for partA is 'Synth A'
        const step0 = screen.getByLabelText('Synth A step 1');
        const step3 = screen.getByLabelText('Synth A step 4');

        // Mouse Down on step 0 with Shift
        fireEvent.mouseDown(step0, { shiftKey: true });

        // Mouse Enter on step 3 (simulating drag)
        fireEvent.mouseEnter(step3);

        // Check if steps 0-3 have selected class
        // We added 'aria-selected' to StepButton
        expect(step0).toHaveAttribute('aria-selected', 'true');
        expect(step3).toHaveAttribute('aria-selected', 'true');

        const step1 = screen.getByLabelText('Synth A step 2');
        expect(step1).toHaveAttribute('aria-selected', 'true');

        // Step 4 should not be selected
        const step4 = screen.getByLabelText('Synth A step 5');
        expect(step4).not.toHaveAttribute('aria-selected', 'true');

        // Verify onPatternChange was NOT called (no toggle)
        expect(onPatternChange).not.toHaveBeenCalled();
    });

    it('should clear selection when Delete key is pressed', () => {
        const onPatternChange = vi.fn();
        // Setup pattern with some notes
        const patternWithNotes = { ...mockPattern };
        patternWithNotes.partA.steps[0] = { note: 'C4', velocity: 1 };
        patternWithNotes.partA.steps[1] = { note: 'C4', velocity: 1 };

        render(<Sequencer {...defaultProps} pattern={patternWithNotes} onPatternChange={onPatternChange} />);

        const step0 = screen.getByLabelText('Synth A step 1');
        const step1 = screen.getByLabelText('Synth A step 2');

        // Select 0-1
        fireEvent.mouseDown(step0, { shiftKey: true });
        fireEvent.mouseEnter(step1);
        fireEvent.mouseUp(window); // End selection

        // Press Delete
        fireEvent.keyDown(window, { key: 'Delete' });

        // Expect onPatternChange to be called for step 0 and 1
        expect(onPatternChange).toHaveBeenCalledWith('partA', 0);
        expect(onPatternChange).toHaveBeenCalledWith('partA', 1);
    });

    it('should normal click toggle step', () => {
        const onPatternChange = vi.fn();
        render(<Sequencer {...defaultProps} onPatternChange={onPatternChange} />);

        const step0 = screen.getByLabelText('Synth A step 1');
        fireEvent.click(step0);

        expect(onPatternChange).toHaveBeenCalledWith('partA', 0);
    });
});
