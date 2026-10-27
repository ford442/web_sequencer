/**
 * EngineA11y.test.tsx
 *
 * Accessibility coverage for the engine-selection controls:
 *  - ProphecyPanel     (ARIA roles, labels, sliders)
 *  - EngineStatusPill  (live region, labels)
 *
 * Each test focuses on a single a11y criterion so failures are easy to triage.
 */

import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ProphecyPanel } from '../ProphecyPanel';
import { EngineStatusPill } from '../EngineStatusPill';

// ─────────────────────────────────────────────────────────────────────────────
// ProphecyPanel a11y
// ─────────────────────────────────────────────────────────────────────────────

describe('ProphecyPanel – accessibility', () => {
    it('wraps controls in a role="group" with aria-label="Prophecy parameters"', () => {
        render(
            <ProphecyPanel
                onVowelChange={vi.fn()}
                onPortamentoChange={vi.fn()}
                onFormantShiftChange={vi.fn()}
            />
        );
        expect(screen.getByRole('group', { name: /Prophecy parameters/i })).toBeInTheDocument();
    });

    it('all five vowel buttons are keyboard-operable (role="button")', () => {
        render(
            <ProphecyPanel
                onVowelChange={vi.fn()}
                onPortamentoChange={vi.fn()}
                onFormantShiftChange={vi.fn()}
            />
        );
        const buttons = screen.getAllByRole('button');
        expect(buttons.length).toBeGreaterThanOrEqual(5);
    });

    it('vowel buttons have aria-pressed reflecting current selection', () => {
        render(
            <ProphecyPanel
                vowel={3}
                onVowelChange={vi.fn()}
                onPortamentoChange={vi.fn()}
                onFormantShiftChange={vi.fn()}
            />
        );
        // index 3 = 'O'
        expect(screen.getByRole('button', { name: /Vowel O/i })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('button', { name: /Vowel A/i })).toHaveAttribute('aria-pressed', 'false');
    });

    it('each vowel button has a descriptive title tooltip', () => {
        render(
            <ProphecyPanel
                onVowelChange={vi.fn()}
                onPortamentoChange={vi.fn()}
                onFormantShiftChange={vi.fn()}
            />
        );
        for (const vowel of ['A', 'E', 'I', 'O', 'U']) {
            const btn = screen.getByRole('button', { name: new RegExp(`Vowel ${vowel}`, 'i') });
            expect(btn).toHaveAttribute('title');
        }
    });

    it('Formant Shift slider has aria-label', () => {
        render(
            <ProphecyPanel
                onVowelChange={vi.fn()}
                onPortamentoChange={vi.fn()}
                onFormantShiftChange={vi.fn()}
            />
        );
        expect(screen.getByRole('slider', { name: 'Formant Shift' })).toBeInTheDocument();
    });

    it('Portamento slider has aria-label', () => {
        render(
            <ProphecyPanel
                onVowelChange={vi.fn()}
                onPortamentoChange={vi.fn()}
                onFormantShiftChange={vi.fn()}
            />
        );
        expect(screen.getByRole('slider', { name: 'Portamento' })).toBeInTheDocument();
    });

    it('Formant Shift slider has a descriptive title attribute', () => {
        render(
            <ProphecyPanel
                formantShift={0.5}
                onVowelChange={vi.fn()}
                onPortamentoChange={vi.fn()}
                onFormantShiftChange={vi.fn()}
            />
        );
        const slider = screen.getByRole('slider', { name: 'Formant Shift' });
        expect(slider).toHaveAttribute('title');
        expect(slider.getAttribute('title')).toMatch(/Formant Shift/i);
    });

    it('Portamento slider has a descriptive title attribute', () => {
        render(
            <ProphecyPanel
                portamento={0.3}
                onVowelChange={vi.fn()}
                onPortamentoChange={vi.fn()}
                onFormantShiftChange={vi.fn()}
            />
        );
        const slider = screen.getByRole('slider', { name: 'Portamento' });
        expect(slider).toHaveAttribute('title');
        expect(slider.getAttribute('title')).toMatch(/Portamento/i);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// EngineStatusPill a11y
// ─────────────────────────────────────────────────────────────────────────────

describe('EngineStatusPill – accessibility', () => {
    it('uses role="status" so screen readers announce engine changes as a live region', () => {
        render(
            <EngineStatusPill
                synthA={{ label: 'A', waveform: '303-saw', engine303: 'jc303' }}
                synthB={{ label: 'B' }}
                bass2={{ label: 'B2' }}
            />
        );
        expect(screen.getByRole('status')).toBeInTheDocument();
    });

    it('container has an accessible name describing its purpose', () => {
        render(
            <EngineStatusPill
                synthA={{ label: 'A', waveform: '303-saw', engine303: 'jc303' }}
                synthB={{ label: 'B' }}
                bass2={{ label: 'B2' }}
            />
        );
        expect(screen.getByLabelText('Active engine indicators')).toBeInTheDocument();
    });

    it('each pill has both aria-label and title for maximum a11y tool compatibility', () => {
        render(
            <EngineStatusPill
                synthA={{ label: 'A', waveform: '303-saw', engine303: 'jc303' }}
                synthB={{ label: 'B' }}
                bass2={{ label: 'B2' }}
            />
        );
        const pill = screen.getByText('A:JC303');
        expect(pill).toHaveAttribute('aria-label');
        expect(pill).toHaveAttribute('title');
    });

    it('renders nothing (no DOM node) when all engines are default', () => {
        const { container } = render(
            <EngineStatusPill
                synthA={{ label: 'A' }}
                synthB={{ label: 'B' }}
                bass2={{ label: 'B2' }}
            />
        );
        expect(container.firstChild).toBeNull();
    });
});
