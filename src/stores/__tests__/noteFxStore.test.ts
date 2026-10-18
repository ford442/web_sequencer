import { afterEach, describe, expect, it, vi } from 'vitest';
import { noteFxStore } from '../noteFxStore';

describe('noteFxStore', () => {
    afterEach(() => noteFxStore.reset());

    it('hands out an inactive default until a track is configured', () => {
        expect(noteFxStore.getActiveChain('partA')).toBeNull();
        expect(noteFxStore.getChain('partA').arp.enabled).toBe(false);
        expect(noteFxStore.hasChains()).toBe(false);
    });

    it('replaces the chain object on every edit (cache key) and notifies', () => {
        const listener = vi.fn();
        const unsub = noteFxStore.subscribe(listener);
        noteFxStore.updateModule('partB', 'arp', { enabled: true });
        const first = noteFxStore.getActiveChain('partB');
        expect(first?.arp.enabled).toBe(true);
        noteFxStore.updateModule('partB', 'arp', { rate: 0.5 });
        const second = noteFxStore.getActiveChain('partB');
        expect(second).not.toBe(first);
        expect(second?.arp).toMatchObject({ enabled: true, rate: 0.5 });
        expect(listener).toHaveBeenCalledTimes(2);
        unsub();
    });

    it('bypass keeps the settings but turns every module off', () => {
        noteFxStore.updateModule('sampler', 'ratchet', { enabled: true, count: 4 });
        noteFxStore.bypass('sampler');
        expect(noteFxStore.getActiveChain('sampler')).toBeNull();
        expect(noteFxStore.getChain('sampler').ratchet.count).toBe(4);
        expect(noteFxStore.exportChains()).toHaveProperty('sampler');
    });

    it('distinct default seeds per track', () => {
        expect(noteFxStore.getChain('partA').seed).not.toBe(noteFxStore.getChain('partB').seed);
    });
});
