import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ScaleSelector } from '../ScaleSelector';

import type { ScaleDefinition } from '../../utils/musicTheory';

describe('ScaleSelector', () => {
    const defaultProps = {
        currentScale: null as ScaleDefinition | null,
        onChange: vi.fn(),
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders KEY button in inactive state', () => {
        render(<ScaleSelector {...defaultProps} currentScale={null} />);
        const button = screen.getByRole('button', { name: 'Key Lock' });
        expect(button).toBeInTheDocument();
        expect(button).toHaveAttribute('aria-pressed', 'false');
    });

    it('does not show root/scale selectors when inactive', () => {
        render(<ScaleSelector {...defaultProps} currentScale={null} />);
        expect(screen.queryByLabelText('Root note')).not.toBeInTheDocument();
        expect(screen.queryByLabelText('Scale type')).not.toBeInTheDocument();
    });

    it('activates with default C Minor when KEY button is clicked', () => {
        const onChange = vi.fn();
        render(<ScaleSelector currentScale={null} onChange={onChange} />);
        
        fireEvent.click(screen.getByRole('button', { name: 'Key Lock' }));
        expect(onChange).toHaveBeenCalledWith({ root: 'C', scale: 'Minor' });
    });

    it('deactivates when KEY button is clicked while active', () => {
        const onChange = vi.fn();
        render(<ScaleSelector currentScale={{ root: 'C', scale: 'Minor' }} onChange={onChange} />);
        
        fireEvent.click(screen.getByRole('button', { name: 'Key Lock' }));
        expect(onChange).toHaveBeenCalledWith(null);
    });

    it('shows root and scale selectors when active', () => {
        render(<ScaleSelector currentScale={{ root: 'G', scale: 'Dorian' }} onChange={vi.fn()} />);
        
        const rootSelect = screen.getByLabelText('Root note');
        expect(rootSelect).toBeInTheDocument();
        expect(rootSelect).toHaveValue('G');

        const scaleSelect = screen.getByLabelText('Scale type');
        expect(scaleSelect).toBeInTheDocument();
        expect(scaleSelect).toHaveValue('Dorian');
    });

    it('changes root note', () => {
        const onChange = vi.fn();
        render(<ScaleSelector currentScale={{ root: 'C', scale: 'Minor' }} onChange={onChange} />);
        
        fireEvent.change(screen.getByLabelText('Root note'), { target: { value: 'G' } });
        expect(onChange).toHaveBeenCalledWith({ root: 'G', scale: 'Minor' });
    });

    it('changes scale type', () => {
        const onChange = vi.fn();
        render(<ScaleSelector currentScale={{ root: 'C', scale: 'Minor' }} onChange={onChange} />);
        
        fireEvent.change(screen.getByLabelText('Scale type'), { target: { value: 'Dorian' } });
        expect(onChange).toHaveBeenCalledWith({ root: 'C', scale: 'Dorian' });
    });

    it('has all 12 root note options', () => {
        render(<ScaleSelector currentScale={{ root: 'C', scale: 'Major' }} onChange={vi.fn()} />);
        const rootSelect = screen.getByLabelText('Root note');
        const options = rootSelect.querySelectorAll('option');
        expect(options).toHaveLength(12);
    });
});
