import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Engine303Selector } from '../Engine303Selector';
import { helpDiscoveryStore } from '../../stores/helpDiscoveryStore';

describe('Engine303Selector', () => {
    beforeEach(() => {
        helpDiscoveryStore._resetForTests();
        helpDiscoveryStore.markTipSeen('engine-303-switch');
    });
    it('renders "Custom Open303" and "Authentic JC303" buttons', () => {
        const onChange = vi.fn();
        render(<Engine303Selector engine="open303" onChange={onChange} />);

        expect(screen.getByRole('button', { name: 'Select Custom Open303 engine' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Select Authentic JC303 engine' })).toBeInTheDocument();
    });

    it('marks Custom Open303 as pressed when engine is open303', () => {
        const onChange = vi.fn();
        render(<Engine303Selector engine="open303" onChange={onChange} />);

        const customBtn = screen.getByRole('button', { name: 'Select Custom Open303 engine' });
        const jc303Btn = screen.getByRole('button', { name: 'Select Authentic JC303 engine' });

        expect(customBtn).toHaveAttribute('aria-pressed', 'true');
        expect(jc303Btn).toHaveAttribute('aria-pressed', 'false');
    });

    it('marks Authentic JC303 as pressed when engine is jc303', () => {
        const onChange = vi.fn();
        render(<Engine303Selector engine="jc303" onChange={onChange} />);

        const customBtn = screen.getByRole('button', { name: 'Select Custom Open303 engine' });
        const jc303Btn = screen.getByRole('button', { name: 'Select Authentic JC303 engine' });

        expect(customBtn).toHaveAttribute('aria-pressed', 'false');
        expect(jc303Btn).toHaveAttribute('aria-pressed', 'true');
    });

    it('calls onChange with "jc303" when Authentic JC303 button is clicked', () => {
        const onChange = vi.fn();
        render(<Engine303Selector engine="open303" onChange={onChange} />);

        fireEvent.click(screen.getByRole('button', { name: 'Select Authentic JC303 engine' }));
        expect(onChange).toHaveBeenCalledOnce();
        expect(onChange).toHaveBeenCalledWith('jc303');
    });

    it('calls onChange with "open303" when Custom Open303 button is clicked', () => {
        const onChange = vi.fn();
        render(<Engine303Selector engine="jc303" onChange={onChange} />);

        fireEvent.click(screen.getByRole('button', { name: 'Select Custom Open303 engine' }));
        expect(onChange).toHaveBeenCalledOnce();
        expect(onChange).toHaveBeenCalledWith('open303');
    });

    it('shows "JC303 ✓" active badge when engine is jc303', () => {
        const onChange = vi.fn();
        render(<Engine303Selector engine="jc303" onChange={onChange} />);

        expect(screen.getByLabelText('JC303 engine active')).toBeInTheDocument();
    });

    it('does not show "JC303 ✓" badge when engine is open303', () => {
        const onChange = vi.fn();
        render(<Engine303Selector engine="open303" onChange={onChange} />);

        expect(screen.queryByLabelText('JC303 engine active')).not.toBeInTheDocument();
    });

    it('Custom Open303 button has a descriptive tooltip', () => {
        const onChange = vi.fn();
        render(<Engine303Selector engine="open303" onChange={onChange} />);

        const customBtn = screen.getByRole('button', { name: 'Select Custom Open303 engine' });
        expect(customBtn).toHaveAttribute('title');
        expect(customBtn.getAttribute('title')).toMatch(/open303/i);
    });

    it('Authentic JC303 button references rosic in its tooltip', () => {
        const onChange = vi.fn();
        render(<Engine303Selector engine="open303" onChange={onChange} />);

        const jc303Btn = screen.getByRole('button', { name: 'Select Authentic JC303 engine' });
        expect(jc303Btn).toHaveAttribute('title');
        expect(jc303Btn.getAttribute('title')).toMatch(/rosic/i);
    });

    it('renders the group with accessible role="group" label', () => {
        const onChange = vi.fn();
        render(<Engine303Selector engine="open303" onChange={onChange} />);

        expect(screen.getByRole('group', { name: /303 engine selection/i })).toBeInTheDocument();
    });

    it('accepts cyan accentColor without errors', () => {
        const onChange = vi.fn();
        render(<Engine303Selector engine="open303" onChange={onChange} accentColor="cyan" />);

        expect(screen.getByRole('button', { name: 'Select Custom Open303 engine' })).toBeInTheDocument();
    });
});
