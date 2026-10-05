import { renderHook } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useTransportHandlers } from '../useTransportHandlers';
import { transportMixStore } from '../../../stores/transportMixStore';
import { nudgePatternLength } from '../../../utils/meterActions';
import type { Pattern } from '../../../types';
import type { useUndoRedo } from '../../useUndoRedo';

type UndoRedo = ReturnType<typeof useUndoRedo<Pattern>>;

const deps = () => ({
    isInitialized: true,
    isReady: true,
    initializeAudio: vi.fn().mockResolvedValue(undefined),
    setIsInitialized: vi.fn(),
    audioEngine: null,
    setSchedPlaying: vi.fn(),
    setTempo: vi.fn(),
    undoRedo: { undo: vi.fn(), redo: vi.fn() } as unknown as UndoRedo,
    setPattern: vi.fn(),
    activeKeyboardNotesRef: { current: new Map<string, number>() },
});

const press = (code: string, init: KeyboardEventInit = {}) =>
    window.dispatchEvent(new KeyboardEvent('keydown', { code, key: code, bubbles: true, cancelable: true, ...init }));

describe('pattern length shortcuts', () => {
    beforeEach(() => {
        transportMixStore.reset();
    });

    it('nudgePatternLength walks the presets and clamps at the ends', () => {
        nudgePatternLength(-1);
        expect(transportMixStore.getSnapshot().stepCount).toBe(24);
        for (let i = 0; i < 10; i++) nudgePatternLength(-1);
        expect(transportMixStore.getSnapshot().stepCount).toBe(8);
        for (let i = 0; i < 10; i++) nudgePatternLength(1);
        expect(transportMixStore.getSnapshot().stepCount).toBe(64);
    });

    it('Shift + [ / ] shortens and lengthens the pattern', () => {
        const { unmount } = renderHook(() => useTransportHandlers(deps()));
        press('BracketLeft', { shiftKey: true });
        expect(transportMixStore.getSnapshot().stepCount).toBe(24);
        press('BracketRight', { shiftKey: true });
        press('BracketRight', { shiftKey: true });
        expect(transportMixStore.getSnapshot().stepCount).toBe(48);
        unmount();
    });

    it('plain [ / ] stay with the live keyboard octave', () => {
        const { unmount } = renderHook(() => useTransportHandlers(deps()));
        press('BracketLeft');
        press('BracketRight');
        expect(transportMixStore.getSnapshot().stepCount).toBe(32);
        unmount();
    });
});
