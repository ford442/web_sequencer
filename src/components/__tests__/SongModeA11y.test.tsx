import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { SongMode } from '../SongMode';

describe('SongMode Accessibility', () => {
    const mockOnUpdateStep = vi.fn();
    const defaultStructure = [
        { partA: 0, partB: null, kick: null, snare: null, closedHat: null, openHat: null, sampler: null },
        { partA: null, partB: null, kick: null, snare: null, closedHat: null, openHat: null, sampler: null }
    ];

    const defaultProps = {
        isVisible: true,
        songStructure: defaultStructure,
        currentSongStep: 0,
        backgroundImage: '',
        onSetBackgroundImage: vi.fn(),
        onUpdateStep: mockOnUpdateStep,
        onToggle: vi.fn(),
        onAddMeasure: vi.fn(),
        onRemoveMeasure: vi.fn(),
        onExportXM: vi.fn(),
        isSongModeActive: false,
        onSetIsSongModeActive: vi.fn(),
        is3D: false
    };

    beforeEach(() => {
        mockOnUpdateStep.mockClear();
    });

    it('handles Enter key to toggle cell value (existing behavior)', () => {
        render(<SongMode {...defaultProps} />);

        // Target a cell with value 0 (partA, step 0)
        const activeCell = screen.getByTestId('cell-partA-0');
        fireEvent.keyDown(activeCell, { key: 'Enter' });

        // Should toggle to null
        expect(mockOnUpdateStep).toHaveBeenCalledWith(0, 'partA', null);

        // Target an empty cell (partB, step 0)
        const emptyCell = screen.getByTestId('cell-partB-0');
        fireEvent.keyDown(emptyCell, { key: 'Enter' });

        // Should toggle to 0
        expect(mockOnUpdateStep).toHaveBeenCalledWith(0, 'partB', 0);
    });

    it('handles ArrowUp to increment pattern number', () => {
        render(<SongMode {...defaultProps} />);

        // Target cell with value 0
        const activeCell = screen.getByTestId('cell-partA-0');
        fireEvent.keyDown(activeCell, { key: 'ArrowUp' });

        // Should increment to 1
        expect(mockOnUpdateStep).toHaveBeenCalledWith(0, 'partA', 1);
    });

    it('handles ArrowDown to decrement pattern number', () => {
        // Render with a structure having value 1
        const structureWithValue = [
            { ...defaultStructure[0], partA: 1 },
            defaultStructure[1]
        ];
        render(<SongMode {...defaultProps} songStructure={structureWithValue} />);

        const activeCell = screen.getByTestId('cell-partA-0');
        fireEvent.keyDown(activeCell, { key: 'ArrowDown' });

        // Should decrement to 0
        expect(mockOnUpdateStep).toHaveBeenCalledWith(0, 'partA', 0);
    });

    it('handles Delete key to clear cell', () => {
        render(<SongMode {...defaultProps} />);

        const activeCell = screen.getByTestId('cell-partA-0');
        fireEvent.keyDown(activeCell, { key: 'Delete' });

        expect(mockOnUpdateStep).toHaveBeenCalledWith(0, 'partA', null);
    });

    it('handles Backspace key to clear cell', () => {
        render(<SongMode {...defaultProps} />);

        const activeCell = screen.getByTestId('cell-partA-0');
        fireEvent.keyDown(activeCell, { key: 'Backspace' });

        expect(mockOnUpdateStep).toHaveBeenCalledWith(0, 'partA', null);
    });

    it('clamps max value at 31 on ArrowUp', () => {
        // Test max clamp (7 -> 7)
        const structureMax = [
            { ...defaultStructure[0], partA: 31 },
            defaultStructure[1]
        ];
        render(<SongMode {...defaultProps} songStructure={structureMax} />);

        const maxCell = screen.getByTestId('cell-partA-0');
        fireEvent.keyDown(maxCell, { key: 'ArrowUp' });

        // Should stay at 31
        expect(mockOnUpdateStep).toHaveBeenCalledWith(0, 'partA', 31);
    });

    it('clamps min value at 0 on ArrowDown', () => {
        // Test min clamp (0 -> 0)
        const structureMin = [
            { ...defaultStructure[0], partA: 0 },
            defaultStructure[1]
        ];
        render(<SongMode {...defaultProps} songStructure={structureMin} />);

        const minCell = screen.getByTestId('cell-partA-0');
        fireEvent.keyDown(minCell, { key: 'ArrowDown' });

        // Should stay at 0
        expect(mockOnUpdateStep).toHaveBeenCalledWith(0, 'partA', 0);
    });

    it('initializes empty cell to 0 on ArrowUp/Down', () => {
        render(<SongMode {...defaultProps} />);

        const emptyCell = screen.getByTestId('cell-partB-0'); // Value is null

        fireEvent.keyDown(emptyCell, { key: 'ArrowUp' });
        expect(mockOnUpdateStep).toHaveBeenCalledWith(0, 'partB', 0);

        mockOnUpdateStep.mockClear();
        fireEvent.keyDown(emptyCell, { key: 'ArrowDown' });
        expect(mockOnUpdateStep).toHaveBeenCalledWith(0, 'partB', 0);
    });
});
