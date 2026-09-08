import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { TrackMuteSoloButtons } from '../sequencer/TrackMuteSoloButtons';
import { trackMuteSoloStore } from '../../stores/trackMuteSoloStore';
import type { TrackKey } from '../../types';

/**
 * A11y contract for the row-header M/S toggles, matching the toggle-button
 * patterns asserted in SongModeA11y.test.tsx.
 */

const renderPads = (trackKey: TrackKey = 'partA', label = 'Lead') =>
    render(
        <svg>
            <TrackMuteSoloButtons trackKey={trackKey} label={label} />
        </svg>,
    );

describe('TrackMuteSoloButtons accessibility', () => {
    beforeEach(() => {
        trackMuteSoloStore.reset();
    });

    it('exposes an accessible name for each toggle', () => {
        renderPads();

        expect(screen.getByRole('button', { name: 'Mute Lead track' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Solo Lead track' })).toBeTruthy();
    });

    it('names the toggles after the row they belong to', () => {
        renderPads('kick', 'Kick');

        expect(screen.getByRole('button', { name: 'Mute Kick track' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Solo Kick track' })).toBeTruthy();
    });

    it('starts unpressed', () => {
        renderPads();

        expect(screen.getByRole('button', { name: 'Mute Lead track' }).getAttribute('aria-pressed')).toBe('false');
        expect(screen.getByRole('button', { name: 'Solo Lead track' }).getAttribute('aria-pressed')).toBe('false');
    });

    it('toggles mute on click and reflects the pressed state', () => {
        renderPads();
        const mute = screen.getByRole('button', { name: 'Mute Lead track' });

        fireEvent.pointerDown(mute);

        expect(mute.getAttribute('aria-pressed')).toBe('true');
        expect(trackMuteSoloStore.isMuted('partA')).toBe(true);

        fireEvent.pointerDown(mute);

        expect(mute.getAttribute('aria-pressed')).toBe('false');
        expect(trackMuteSoloStore.isMuted('partA')).toBe(false);
    });

    it('toggles solo with Enter and Space', () => {
        renderPads();
        const solo = screen.getByRole('button', { name: 'Solo Lead track' });

        fireEvent.keyDown(solo, { key: 'Enter' });
        expect(solo.getAttribute('aria-pressed')).toBe('true');
        expect(trackMuteSoloStore.isSoloed('partA')).toBe(true);

        fireEvent.keyDown(solo, { key: ' ' });
        expect(solo.getAttribute('aria-pressed')).toBe('false');
        expect(trackMuteSoloStore.isSoloed('partA')).toBe(false);
    });

    it('is reachable by keyboard', () => {
        renderPads();

        expect(screen.getByRole('button', { name: 'Mute Lead track' }).getAttribute('tabindex')).toBe('0');
        expect(screen.getByRole('button', { name: 'Solo Lead track' }).getAttribute('tabindex')).toBe('0');
    });

    it('reflects state changed elsewhere in the app', () => {
        renderPads();

        act(() => {
            trackMuteSoloStore.toggleMute('partA');
        });

        expect(screen.getByRole('button', { name: 'Mute Lead track' }).getAttribute('aria-pressed')).toBe('true');
    });

    it('does not mark a track pressed just because another track is soloed', () => {
        renderPads();

        act(() => {
            trackMuteSoloStore.toggleSolo('kick');
        });

        // partA is silenced by the solo mask, but neither of its own toggles is engaged.
        expect(screen.getByRole('button', { name: 'Mute Lead track' }).getAttribute('aria-pressed')).toBe('false');
        expect(screen.getByRole('button', { name: 'Solo Lead track' }).getAttribute('aria-pressed')).toBe('false');
        expect(trackMuteSoloStore.isAudible('partA')).toBe(false);
    });
});
