import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { SongMode } from '../components/SongMode';

describe('SongMode Accessibility', () => {
    const mockSongStructure = [
        { partA: null, partB: null, kick: null, snare: null, closedHat: null, openHat: null, sampler: null },
        { partA: 0, partB: null, kick: null, snare: null, closedHat: null, openHat: null, sampler: null },
    ];

    const defaultProps = {
        isVisible: true,
        songStructure: mockSongStructure,
        currentSongStep: 0,
        backgroundImage: '',
        onSetBackgroundImage: vi.fn(),
        onUpdateStep: vi.fn(),
        onToggle: vi.fn(),
        onAddMeasure: vi.fn(),
        onRemoveMeasure: vi.fn(),
        onExportXM: vi.fn(),
    };

    it('renders grid cells with correct accessibility attributes', () => {
        render(<SongMode {...defaultProps} />);

        // Find empty cell
        const emptyCell = screen.getByLabelText(/LEAD Measure 1, Empty/i);
        expect(emptyCell).toBeInTheDocument();
        expect(emptyCell).toHaveAttribute('role', 'button');
        expect(emptyCell).toHaveAttribute('tabIndex', '0');

        // Find filled cell
        const filledCell = screen.getByLabelText(/LEAD Measure 2, Pattern 1/i);
        expect(filledCell).toBeInTheDocument();
        expect(filledCell).toHaveAttribute('role', 'button');
        expect(filledCell).toHaveAttribute('tabIndex', '0');
    });

    it('supports keyboard interaction to toggle cells', () => {
        const onUpdateStep = vi.fn();
        render(<SongMode {...defaultProps} onUpdateStep={onUpdateStep} />);

        const emptyCell = screen.getByLabelText(/LEAD Measure 1, Empty/i);

        // Simulate Enter key on empty cell -> Should set to Pattern 0 (index 0)
        fireEvent.keyDown(emptyCell, { key: 'Enter', code: 'Enter' });
        expect(onUpdateStep).toHaveBeenCalledWith(0, 'partA', 0);

        // Simulate Space key on filled cell -> Should clear it (null)
        const filledCell = screen.getByLabelText(/LEAD Measure 2, Pattern 1/i);
        fireEvent.keyDown(filledCell, { key: ' ', code: 'Space' });
        expect(onUpdateStep).toHaveBeenCalledWith(1, 'partA', null);
    });

    it('renders correct labels for tracks', () => {
        render(<SongMode {...defaultProps} />);
        expect(screen.getByText('LEAD')).toBeInTheDocument();
        expect(screen.getByText('BASS')).toBeInTheDocument();
        expect(screen.getByText('KICK')).toBeInTheDocument();
    });
});
