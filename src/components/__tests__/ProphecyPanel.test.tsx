import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ProphecyPanel } from '../ProphecyPanel';

const noop = () => {};

describe('ProphecyPanel', () => {
    it('renders vowel buttons A E I O U', () => {
        render(
            <ProphecyPanel
                onVowelChange={noop}
                onPortamentoChange={noop}
                onFormantShiftChange={noop}
            />
        );
        for (const vowel of ['A', 'E', 'I', 'O', 'U']) {
            expect(screen.getByRole('button', { name: `Vowel ${vowel}` })).toBeInTheDocument();
        }
    });

    it('marks the active vowel button as pressed', () => {
        render(
            <ProphecyPanel
                vowel={2}
                onVowelChange={noop}
                onPortamentoChange={noop}
                onFormantShiftChange={noop}
            />
        );
        // Vowel index 2 = 'I'
        expect(screen.getByRole('button', { name: /Vowel I/i })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('button', { name: /Vowel A/i })).toHaveAttribute('aria-pressed', 'false');
    });

    it('calls onVowelChange with the correct index when a vowel button is clicked', () => {
        const onVowelChange = vi.fn();
        render(
            <ProphecyPanel
                onVowelChange={onVowelChange}
                onPortamentoChange={noop}
                onFormantShiftChange={noop}
            />
        );
        fireEvent.click(screen.getByRole('button', { name: /Vowel E/i }));
        expect(onVowelChange).toHaveBeenCalledOnce();
        expect(onVowelChange).toHaveBeenCalledWith(1);
    });

    it('calls onVowelChange(0) when vowel A is clicked', () => {
        const onVowelChange = vi.fn();
        render(
            <ProphecyPanel
                onVowelChange={onVowelChange}
                onPortamentoChange={noop}
                onFormantShiftChange={noop}
            />
        );
        fireEvent.click(screen.getByRole('button', { name: /Vowel A/i }));
        expect(onVowelChange).toHaveBeenCalledWith(0);
    });

    it('calls onVowelChange(4) when vowel U is clicked', () => {
        const onVowelChange = vi.fn();
        render(
            <ProphecyPanel
                onVowelChange={onVowelChange}
                onPortamentoChange={noop}
                onFormantShiftChange={noop}
            />
        );
        fireEvent.click(screen.getByRole('button', { name: /Vowel U/i }));
        expect(onVowelChange).toHaveBeenCalledWith(4);
    });

    it('renders Formant Shift slider with correct aria-label', () => {
        render(
            <ProphecyPanel
                onVowelChange={noop}
                onPortamentoChange={noop}
                onFormantShiftChange={noop}
            />
        );
        expect(screen.getByRole('slider', { name: 'Formant Shift' })).toBeInTheDocument();
    });

    it('renders Portamento slider with correct aria-label', () => {
        render(
            <ProphecyPanel
                onVowelChange={noop}
                onPortamentoChange={noop}
                onFormantShiftChange={noop}
            />
        );
        expect(screen.getByRole('slider', { name: 'Portamento' })).toBeInTheDocument();
    });

    it('calls onFormantShiftChange when Formant Shift slider is changed', () => {
        const onFormantShiftChange = vi.fn();
        render(
            <ProphecyPanel
                onVowelChange={noop}
                onPortamentoChange={noop}
                onFormantShiftChange={onFormantShiftChange}
            />
        );
        fireEvent.change(screen.getByRole('slider', { name: 'Formant Shift' }), {
            target: { value: '0.75' },
        });
        expect(onFormantShiftChange).toHaveBeenCalledOnce();
        expect(onFormantShiftChange).toHaveBeenCalledWith(0.75);
    });

    it('calls onPortamentoChange when Portamento slider is changed', () => {
        const onPortamentoChange = vi.fn();
        render(
            <ProphecyPanel
                onVowelChange={noop}
                onPortamentoChange={onPortamentoChange}
                onFormantShiftChange={noop}
            />
        );
        fireEvent.change(screen.getByRole('slider', { name: 'Portamento' }), {
            target: { value: '0.5' },
        });
        expect(onPortamentoChange).toHaveBeenCalledOnce();
        expect(onPortamentoChange).toHaveBeenCalledWith(0.5);
    });

    it('renders the group with role="group" and aria-label="Prophecy parameters"', () => {
        render(
            <ProphecyPanel
                onVowelChange={noop}
                onPortamentoChange={noop}
                onFormantShiftChange={noop}
            />
        );
        expect(screen.getByRole('group', { name: /Prophecy parameters/i })).toBeInTheDocument();
    });

    it('accepts pink accentColor without errors', () => {
        render(
            <ProphecyPanel
                accentColor="pink"
                onVowelChange={noop}
                onPortamentoChange={noop}
                onFormantShiftChange={noop}
            />
        );
        expect(screen.getByRole('group', { name: /Prophecy parameters/i })).toBeInTheDocument();
    });

    it('defaults vowel to 0 (vowel A pressed) when not provided', () => {
        render(
            <ProphecyPanel
                onVowelChange={noop}
                onPortamentoChange={noop}
                onFormantShiftChange={noop}
            />
        );
        expect(screen.getByRole('button', { name: /Vowel A/i })).toHaveAttribute('aria-pressed', 'true');
    });
});
