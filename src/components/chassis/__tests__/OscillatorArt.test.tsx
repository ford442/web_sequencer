import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { OscillatorPanelArt } from '../OscillatorPanelArt';
import { OscillatorSignatureIcon } from '../OscillatorSignatureIcon';
import { HardwareChassis } from '../HardwareChassis';
import { OSCILLATOR_PANEL_FOCUS, OSCILLATOR_PANEL_IMAGES, OSCILLATOR_THEMES, oscillatorPanelImageUrl } from '../../oscillatorThemes';
import { OscillatorTypeSelector } from '../../OscillatorTypeSelector';
import type { OscillatorType } from '../../../types';

const TYPES = Object.keys(OSCILLATOR_THEMES) as OscillatorType[];

describe('oscillator panel art (#1583)', () => {
    it('every family has artwork under /osc/ and a focus point', () => {
        for (const t of TYPES) {
            expect(OSCILLATOR_PANEL_IMAGES[t]).toMatch(/^\/osc\/[a-z0-9]+\.webp$/);
            expect(OSCILLATOR_PANEL_FOCUS[t]).toMatch(/^\d+% \d+%$/);
        }
    });

    it('resolves art against the deploy base instead of the site root', () => {
        const base = import.meta.env.BASE_URL;
        expect(oscillatorPanelImageUrl('javascript')).toBe(`${base.endsWith('/') ? base : `${base}/`}osc/js.webp`);
        expect(oscillatorPanelImageUrl('jc303')).not.toMatch(/\/\/osc/);
    });

    it('swaps the artwork when the oscillator type changes', () => {
        const { rerender } = render(<OscillatorPanelArt type="javascript" />);
        expect(screen.getByRole('img', { name: 'JavaScript oscillator panel' })).toHaveAttribute('src', oscillatorPanelImageUrl('javascript'));
        rerender(<OscillatorPanelArt type="prophecy" />);
        const img = screen.getByRole('img', { name: 'Prophecy oscillator panel' });
        expect(img).toHaveAttribute('src', oscillatorPanelImageUrl('prophecy'));
        expect(screen.getByTestId('oscillator-panel-art')).toHaveAttribute('data-osc-type', 'prophecy');
    });

    it('falls back to a themed label when the file is missing, and recovers on the next type', () => {
        const { rerender } = render(<OscillatorPanelArt type="webgpu" />);
        fireEvent.error(screen.getByRole('img'));
        expect(screen.queryByRole('img')).toBeNull();
        expect(screen.getByText('WEBGPU')).toBeInTheDocument();
        rerender(<OscillatorPanelArt type="wam" />);
        expect(screen.getByRole('img', { name: 'WASM OSC oscillator panel' })).toBeInTheDocument();
    });

    it('backdrop variant hosts controls on top of the art', () => {
        const onClick = vi.fn();
        render(
            <OscillatorPanelArt type="macro" variant="backdrop">
                <button type="button" onClick={onClick}>Morph</button>
            </OscillatorPanelArt>,
        );
        fireEvent.click(screen.getByRole('button', { name: 'Morph' }));
        expect(onClick).toHaveBeenCalledTimes(1);
    });
});

describe('oscillator signature icons (#1587)', () => {
    it('draws a distinct glyph for every family', () => {
        const markup = new Set<string>();
        for (const t of TYPES) {
            const { container, unmount } = render(<OscillatorSignatureIcon type={t} />);
            const svg = container.querySelector('svg')!;
            expect(svg).toHaveAttribute('aria-hidden', 'true');
            expect(svg.childElementCount).toBeGreaterThan(0);
            markup.add(svg.innerHTML);
            unmount();
        }
        expect(markup.size).toBe(TYPES.length);
    });

    it('is announced when given a title', () => {
        render(<OscillatorSignatureIcon type="pyodide" title="Pyodide oscillator" />);
        expect(screen.getByRole('img', { name: 'Pyodide oscillator' })).toBeInTheDocument();
    });

    it('OscillatorTypeSelector shows icons only inside the chassis', () => {
        const { container, unmount } = render(<OscillatorTypeSelector type="javascript" onChange={() => undefined} />);
        expect(container.querySelectorAll('[data-osc-icon]')).toHaveLength(0);
        unmount();

        const onChange = vi.fn();
        const { container: inChassis } = render(
            <HardwareChassis mode="osc" ledStrip={null}>
                <OscillatorTypeSelector type="javascript" onChange={onChange} />
            </HardwareChassis>,
        );
        expect(inChassis.querySelectorAll('[data-osc-icon]')).toHaveLength(TYPES.length);
        fireEvent.click(screen.getByRole('button', { name: /JC303 oscillator family|JC/ }));
        expect(onChange).toHaveBeenCalledWith('jc303');
    });
});

describe('OSCILLATOR_ACCENT_HEX', () => {
    it('has a hex colour for every themed oscillator type', async () => {
        const { OSCILLATOR_ACCENT_HEX, OSCILLATOR_THEMES } = await import('../../oscillatorThemes');
        for (const type of Object.keys(OSCILLATOR_THEMES)) {
            expect(OSCILLATOR_ACCENT_HEX[type as keyof typeof OSCILLATOR_ACCENT_HEX]).toMatch(/^#[0-9a-f]{6}$/);
        }
    });
});
