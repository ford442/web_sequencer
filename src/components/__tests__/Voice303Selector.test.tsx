import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { Voice303Selector } from '../Voice303Selector';
import { getAvailableTB303Models } from '../../engines/TB303Models';

describe('Voice303Selector', () => {
    it('renders one button per available voice from the registry', () => {
        render(<Voice303Selector model="stock-open303" onChange={vi.fn()} />);
        for (const m of getAvailableTB303Models()) {
            expect(screen.getByRole('button', { name: `Select ${m.label} voice` })).toBeInTheDocument();
        }
    });

    it('marks the active voice with aria-pressed', () => {
        render(<Voice303Selector model="experimental-01" onChange={vi.fn()} />);
        expect(screen.getByRole('button', { name: 'Select Experimental 01 voice' }))
            .toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('button', { name: 'Select Stock Open303 voice' }))
            .toHaveAttribute('aria-pressed', 'false');
    });

    it('calls onChange with the picked model id', () => {
        const onChange = vi.fn();
        render(<Voice303Selector model="stock-open303" onChange={onChange} />);
        fireEvent.click(screen.getByRole('button', { name: 'Select Authentic JC303 voice' }));
        expect(onChange).toHaveBeenCalledWith('jc303');
    });

    it('exposes the voice description as a tooltip', () => {
        render(<Voice303Selector model="stock-open303" onChange={vi.fn()} />);
        for (const m of getAvailableTB303Models()) {
            expect(screen.getByRole('button', { name: `Select ${m.label} voice` }))
                .toHaveAttribute('title', m.description);
        }
    });

    it('shows the OPEN303 family badge for open303-family voices', () => {
        render(<Voice303Selector model="1ink303-v1" onChange={vi.fn()} />);
        expect(screen.getByLabelText('Open303 engine family active')).toBeInTheDocument();
    });

    it('shows the JC303 family badge when a jc303-family voice is active', () => {
        render(<Voice303Selector model="jc303" onChange={vi.fn()} />);
        expect(screen.getByLabelText('JC303 engine family active')).toBeInTheDocument();
    });

    it('is grouped and labelled for assistive tech', () => {
        render(<Voice303Selector model="stock-open303" onChange={vi.fn()} />);
        expect(screen.getByRole('group', { name: '303 voice selection' })).toBeInTheDocument();
    });
});
