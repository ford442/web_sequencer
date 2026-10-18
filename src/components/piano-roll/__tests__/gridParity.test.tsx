/**
 * Acceptance (#1345): an edit made in the piano roll produces exactly the
 * pattern the same edit makes on the step grid, and goes through the same
 * undo history and track storage.
 */
import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useRef, useState } from 'react';
import type { Note, Pattern, PartSequence } from '@/types';
import type { TrackKey } from '@/constants/appDefaults';
import { useUndoRedo } from '@/hooks/useUndoRedo';
import { usePatternHandlers } from '@/hooks/appState/usePatternHandlers';
import { drawNote, resizeNotes, toggleSlide } from '../model/rollEdits';

type TrackStorage = Record<TrackKey, (PartSequence | PartSequence[] | null)[]>;

const steps = (): (Note | null)[] => Array<Note | null>(32).fill(null);
const initialPattern = (): Pattern => ({
    partA: { steps: steps() },
    partB: { steps: steps() },
    bass2: { steps: steps() },
    kick: { steps: steps() },
    snare: { steps: steps() },
    closedHat: { steps: steps() },
    openHat: { steps: steps() },
    sampler: Array.from({ length: 8 }, () => ({ steps: steps() })),
});

function useHarness() {
    const [pattern, setPatternState] = useState<Pattern>(initialPattern);
    const patternRef = useRef(pattern);
    const setPattern: React.Dispatch<React.SetStateAction<Pattern>> = (action) => {
        setPatternState((prev) => {
            const next = typeof action === 'function' ? action(prev) : action;
            patternRef.current = next;
            return next;
        });
    };
    const undoRedo = useUndoRedo<Pattern>(50);
    const activeSamplerBankRef = useRef(0);
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number; track: TrackKey; step: number } | null>(null);
    const [storage, setStorageState] = useState<TrackStorage>(() => ({
        partA: [null], partB: [null], bass2: [null], kick: [null], snare: [null],
        closedHat: [null], openHat: [null], sampler: [null],
    }));
    const trackStorageRef = useRef(storage);
    const setTrackStorage: React.Dispatch<React.SetStateAction<TrackStorage>> = (action) => {
        setStorageState((prev) => {
            const next = typeof action === 'function' ? action(prev) : action;
            trackStorageRef.current = next;
            return next;
        });
    };
    const activeTrackSlotsRef = useRef<Record<TrackKey, number>>({
        partA: 0, partB: 0, bass2: 0, kick: 0, snare: 0, closedHat: 0, openHat: 0, sampler: 0,
    });
    const handlers = usePatternHandlers({
        patternRef, setPattern, undoRedo, activeSamplerBankRef,
        contextMenu, setContextMenu, setSelection: () => {},
        trackStorageRef, activeTrackSlotsRef, setTrackStorage, setActiveTrackSlots: () => {},
        setSelectedTrack: () => {},
    });
    return { pattern, patternRef, storage, undoRedo, setContextMenu, ...handlers };
}

const toggleEvent = { altKey: false, ctrlKey: false, metaKey: false, preventDefault: () => {} };

describe('piano roll ↔ step grid parity', () => {
    it('drawing a note equals a grid toggle followed by a pitch pick', () => {
        const grid = renderHook(() => useHarness());
        act(() => grid.result.current.handleStepToggle('partA', 5, toggleEvent));
        act(() => grid.result.current.setContextMenu({ x: 0, y: 0, track: 'partA', step: 5 }));
        act(() => grid.result.current.handleNoteSelect('E4'));

        const roll = renderHook(() => useHarness());
        const edit = drawNote(roll.result.current.pattern.partA.steps, 5, 64);
        act(() => roll.result.current.handleReplaceTrackSteps('partA', 0, edit.steps as (Note | null)[]));

        expect(roll.result.current.pattern).toEqual(grid.result.current.pattern);
        expect(roll.result.current.storage.partA[0]).toEqual(grid.result.current.storage.partA[0]);
    });

    it('a length edit equals the grid length edit, covered steps included', () => {
        const seed = (h: ReturnType<typeof useHarness>) => {
            act(() => h.handleStepToggle('bass2', 0, toggleEvent));
            act(() => h.handleStepToggle('bass2', 1, toggleEvent));
        };
        const grid = renderHook(() => useHarness());
        seed(grid.result.current);
        act(() => grid.result.current.handleEditLength('bass2', 0, 3));

        const roll = renderHook(() => useHarness());
        seed(roll.result.current);
        const edit = resizeNotes(roll.result.current.pattern.bass2.steps, [{ step: 0, voice: 0 }], 2);
        act(() => roll.result.current.handleReplaceTrackSteps('bass2', 0, edit.steps as (Note | null)[]));

        expect(roll.result.current.pattern.bass2).toEqual(grid.result.current.pattern.bass2);
    });

    it('a slide toggle equals Alt-click on the grid', () => {
        const grid = renderHook(() => useHarness());
        act(() => grid.result.current.handleStepToggle('partB', 3, toggleEvent));
        act(() => grid.result.current.handleStepToggle('partB', 3, { ...toggleEvent, altKey: true }));

        const roll = renderHook(() => useHarness());
        act(() => roll.result.current.handleStepToggle('partB', 3, toggleEvent));
        const edit = toggleSlide(roll.result.current.pattern.partB.steps, 3);
        act(() => roll.result.current.handleReplaceTrackSteps('partB', 0, edit.steps as (Note | null)[]));

        expect(roll.result.current.pattern.partB).toEqual(grid.result.current.pattern.partB);
    });

    it('edits a specific sampler bank and is one undo step', () => {
        const h = renderHook(() => useHarness());
        const before = h.result.current.pattern;
        const edit = drawNote(before.sampler[3].steps, 0, 72);
        act(() => h.result.current.handleReplaceTrackSteps('sampler', 3, edit.steps as (Note | null)[]));
        expect(h.result.current.pattern.sampler[3].steps[0]).toMatchObject({ note: 'C5' });
        expect(h.result.current.pattern.sampler[0]).toBe(before.sampler[0]);
        expect(h.result.current.undoRedo.undo()).toBe(before);
    });

    it('pastes with the grid paste rules', () => {
        const h = renderHook(() => useHarness());
        const clip: (Note | null)[] = [{ note: 'G4', velocity: 1, length: 1, slide: false }, null];
        act(() => h.result.current.handlePasteTrackSteps('partA', 0, clip, 30));
        const s = h.result.current.pattern.partA.steps;
        expect(s[30]).toMatchObject({ note: 'G4' });
        // Grid paste stops at the end of the track's steps.
        expect(s).toHaveLength(32);
    });
});
