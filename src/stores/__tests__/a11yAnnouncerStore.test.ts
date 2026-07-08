import { describe, it, expect, vi } from 'vitest';
import { a11yAnnouncerStore } from '../a11yAnnouncerStore';

describe('a11yAnnouncerStore', () => {
    it('notifies subscribers with announcements', () => {
        const listener = vi.fn();
        const unsub = a11yAnnouncerStore.subscribe(listener);
        a11yAnnouncerStore.announce('Playback started');
        expect(listener).toHaveBeenCalled();
        const last = listener.mock.calls.at(-1)?.[0];
        expect(last?.message).toBe('Playback started');
        expect(last?.politeness).toBe('polite');
        unsub();
    });

    it('throttles duplicate messages', () => {
        const listener = vi.fn();
        const unsub = a11yAnnouncerStore.subscribe(listener);
        const before = listener.mock.calls.length;
        a11yAnnouncerStore.announce('Step 1');
        a11yAnnouncerStore.announce('Step 1');
        expect(listener.mock.calls.length - before).toBe(1);
        unsub();
    });
});
