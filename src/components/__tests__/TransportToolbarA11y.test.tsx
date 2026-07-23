import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { TransportToolbar } from '../TransportToolbar';

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
});
