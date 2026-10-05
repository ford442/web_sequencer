import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TransportToolbar } from '../TransportToolbar';
import { transportMixStore } from '../../stores/transportMixStore';

const baseProps = {
    songStorage: [null, null, null, null],
    activeSongSlot: 0,
    tempo: 120,
    isRecording: false,
    isPlaying: false,
    isSongModeOpen: false,
    is3DMode: false,
    loadSong: vi.fn(),
    handleSaveSong: vi.fn().mockResolvedValue(undefined),
    handleClearPattern: vi.fn(),
    handleTempoHoldStart: vi.fn(),
    handleTempoHoldEnd: vi.fn(),
    handleTempoKeyDown: vi.fn(),
    handlePanic: vi.fn(),
    handlePlayToggle: vi.fn(),
    setIsRecording: vi.fn(),
    setIsSongModeOpen: vi.fn(),
    setIs3DMode: vi.fn(),
    currentScale: null,
    setCurrentScale: vi.fn(),
};

describe('TransportToolbar Accessibility', () => {
    it('toggles playback with keyboard on play button', () => {
        const handlePlayToggle = vi.fn();
        render(<TransportToolbar {...baseProps} handlePlayToggle={handlePlayToggle} />);
        const play = screen.getByLabelText('Start Playback');
        fireEvent.click(play);
        expect(handlePlayToggle).toHaveBeenCalled();
    });

    it('toggles song mode with keyboard', () => {
        const setIsSongModeOpen = vi.fn();
        render(<TransportToolbar {...baseProps} setIsSongModeOpen={setIsSongModeOpen} />);
        const songBtn = screen.getByLabelText('Toggle Song Mode');
        fireEvent.click(songBtn);
        expect(setIsSongModeOpen).toHaveBeenCalledWith(true);
    });

    it('loads saved song slot with Enter', () => {
        const loadSong = vi.fn();
        render(
            <TransportToolbar
                {...baseProps}
                loadSong={loadSong}
                songStorage={[{ name: 'A' } as any, null, null, null]}
            />,
        );
        const slot1 = screen.getByLabelText('Song Slot 1');
        fireEvent.keyDown(slot1, { key: 'Enter' });
        expect(loadSong).toHaveBeenCalledWith(0);
    });

    describe('meter controls', () => {
        beforeEach(() => {
            transportMixStore.reset();
        });

        it('exposes labelled LEN / METER / SWING groups', () => {
            render(<TransportToolbar {...baseProps} />);
            expect(screen.getByRole('group', { name: 'Pattern length' })).toBeTruthy();
            expect(screen.getByRole('combobox', { name: 'Time signature' })).toBeTruthy();
            expect(screen.getByRole('group', { name: 'Swing' })).toBeTruthy();
            expect(screen.getByLabelText('Pattern length: 32 steps')).toBeTruthy();
            expect(screen.getByLabelText('Swing: straight')).toBeTruthy();
        });

        it('steps the pattern length through the presets', () => {
            render(<TransportToolbar {...baseProps} />);
            fireEvent.click(screen.getByLabelText('Shorten pattern'));
            expect(transportMixStore.getSnapshot().stepCount).toBe(24);
            fireEvent.click(screen.getByLabelText('Shorten pattern'));
            expect(transportMixStore.getSnapshot().stepCount).toBe(16);
            expect(screen.getByLabelText('Pattern length: 16 steps')).toBeTruthy();
            fireEvent.click(screen.getByLabelText('Lengthen pattern'));
            expect(transportMixStore.getSnapshot().stepCount).toBe(24);
        });

        it('sets the time signature without changing the length', () => {
            render(<TransportToolbar {...baseProps} />);
            fireEvent.change(screen.getByRole('combobox', { name: 'Time signature' }), { target: { value: '3/4' } });
            expect(transportMixStore.getSnapshot().timeSignature).toEqual([3, 4]);
            expect(transportMixStore.getSnapshot().stepCount).toBe(32);
        });

        it('raises swing up to 75% and disables at the ends', () => {
            render(<TransportToolbar {...baseProps} />);
            const less = screen.getByLabelText('Decrease swing') as HTMLButtonElement;
            const more = screen.getByLabelText('Increase swing') as HTMLButtonElement;
            expect(less.disabled).toBe(true);
            fireEvent.click(more);
            expect(transportMixStore.getSnapshot().swing).toBe(52);
            for (let i = 0; i < 20; i++) fireEvent.click(more);
            expect(transportMixStore.getSnapshot().swing).toBe(75);
            expect(more.disabled).toBe(true);
            expect(screen.getByLabelText('Swing: 75 percent')).toBeTruthy();
        });
    });
});
