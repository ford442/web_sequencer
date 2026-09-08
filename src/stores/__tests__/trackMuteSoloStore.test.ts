import { describe, it, expect, beforeEach, vi } from 'vitest';
import { trackMuteSoloStore } from '../trackMuteSoloStore';

describe('trackMuteSoloStore', () => {
    beforeEach(() => {
        trackMuteSoloStore.reset();
    });

    describe('solo mask', () => {
        it('makes every track audible when nothing is muted or soloed', () => {
            expect(trackMuteSoloStore.isAudible('partA')).toBe(true);
            expect(trackMuteSoloStore.isAudible('sampler')).toBe(true);
        });

        it('silences only the muted track when nothing is soloed', () => {
            trackMuteSoloStore.toggleMute('kick');

            expect(trackMuteSoloStore.isAudible('kick')).toBe(false);
            expect(trackMuteSoloStore.isAudible('snare')).toBe(true);
        });

        it('silences every non-soloed track once anything is soloed', () => {
            trackMuteSoloStore.toggleSolo('bass2');

            expect(trackMuteSoloStore.isAudible('bass2')).toBe(true);
            expect(trackMuteSoloStore.isAudible('partA')).toBe(false);
            expect(trackMuteSoloStore.isAudible('kick')).toBe(false);
        });

        it('keeps a track that is both muted and soloed audible — solo wins', () => {
            trackMuteSoloStore.toggleMute('partA');
            trackMuteSoloStore.toggleSolo('partA');

            expect(trackMuteSoloStore.isMuted('partA')).toBe(true);
            expect(trackMuteSoloStore.isSoloed('partA')).toBe(true);
            expect(trackMuteSoloStore.isAudible('partA')).toBe(true);
        });

        it('sounds every soloed track when several are soloed', () => {
            trackMuteSoloStore.toggleSolo('kick');
            trackMuteSoloStore.toggleSolo('snare');
            trackMuteSoloStore.toggleSolo('closedHat');

            expect(trackMuteSoloStore.isAudible('kick')).toBe(true);
            expect(trackMuteSoloStore.isAudible('snare')).toBe(true);
            expect(trackMuteSoloStore.isAudible('closedHat')).toBe(true);
            expect(trackMuteSoloStore.isAudible('openHat')).toBe(false);
            expect(trackMuteSoloStore.isAudible('partB')).toBe(false);
        });

        it('restores mute semantics when the last solo is cleared', () => {
            trackMuteSoloStore.toggleMute('kick');
            trackMuteSoloStore.toggleSolo('snare');
            trackMuteSoloStore.toggleSolo('openHat');

            expect(trackMuteSoloStore.isAudible('kick')).toBe(false);
            expect(trackMuteSoloStore.isAudible('partA')).toBe(false);

            trackMuteSoloStore.toggleSolo('snare');
            // One solo still standing — the mask is unchanged in kind.
            expect(trackMuteSoloStore.isAudible('partA')).toBe(false);

            trackMuteSoloStore.toggleSolo('openHat');
            // No solos left: the mute from before is honored again, nothing else.
            expect(trackMuteSoloStore.isAudible('kick')).toBe(false);
            expect(trackMuteSoloStore.isAudible('partA')).toBe(true);
            expect(trackMuteSoloStore.isAudible('snare')).toBe(true);
        });
    });

    describe('state and notification', () => {
        it('toggles mute and solo independently', () => {
            trackMuteSoloStore.toggleMute('partB');
            expect(trackMuteSoloStore.isMuted('partB')).toBe(true);
            trackMuteSoloStore.toggleMute('partB');
            expect(trackMuteSoloStore.isMuted('partB')).toBe(false);
        });

        it('emits the current state on subscribe and on every change', () => {
            const listener = vi.fn();
            const unsub = trackMuteSoloStore.subscribe(listener);

            expect(listener).toHaveBeenCalledWith({ muted: [], soloed: [], anySoloed: false });

            trackMuteSoloStore.toggleMute('kick');
            expect(listener.mock.calls.at(-1)?.[0]).toEqual({
                muted: ['kick'],
                soloed: [],
                anySoloed: false,
            });

            trackMuteSoloStore.toggleSolo('snare');
            expect(listener.mock.calls.at(-1)?.[0]).toEqual({
                muted: ['kick'],
                soloed: ['snare'],
                anySoloed: true,
            });

            unsub();
            const before = listener.mock.calls.length;
            trackMuteSoloStore.toggleMute('openHat');
            expect(listener.mock.calls.length).toBe(before);
        });

        it('does not notify when a set call is a no-op', () => {
            const listener = vi.fn();
            const unsub = trackMuteSoloStore.subscribe(listener);
            const before = listener.mock.calls.length;

            trackMuteSoloStore.setMuted('kick', false);

            expect(listener.mock.calls.length).toBe(before);
            unsub();
        });

        it('reset clears mutes and solos', () => {
            trackMuteSoloStore.toggleMute('kick');
            trackMuteSoloStore.toggleSolo('snare');

            trackMuteSoloStore.reset();

            expect(trackMuteSoloStore.getState()).toEqual({ muted: [], soloed: [], anySoloed: false });
            expect(trackMuteSoloStore.isAudible('kick')).toBe(true);
        });
    });
});
