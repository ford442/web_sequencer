import { describe, it, expect, vi } from 'vitest';
import { createAppStateStore, shallowEqual } from '../appStateStore';

interface Demo {
    count: number;
    label: string;
    bump: () => number;
    list: number[];
}

function makeDemo(overrides: Partial<Demo> = {}): Demo {
    return { count: 0, label: 'a', bump: () => 0, list: [], ...overrides };
}

describe('createAppStateStore', () => {
    it('publishes function fields as proxies that never change identity', () => {
        const store = createAppStateStore(makeDemo());
        const first = store.getSnapshot().bump;

        store.commit(makeDemo({ count: 1, bump: () => 1 }));
        store.flush();

        expect(store.getSnapshot().bump).toBe(first);
    });

    it('forwards proxy calls to the latest raw function, even before flush()', () => {
        const store = createAppStateStore(makeDemo({ bump: () => 1 }));
        const proxy = store.getSnapshot().bump;
        expect(proxy()).toBe(1);

        // commit() is what insertion effects run; a child layout effect that
        // fires before flush() must already reach the new closure.
        store.commit(makeDemo({ bump: () => 2 }));
        expect(proxy()).toBe(2);
    });

    it('does not notify until flush(), and notifies once per changed commit', () => {
        const store = createAppStateStore(makeDemo());
        const listener = vi.fn();
        store.subscribe(listener);

        store.commit(makeDemo({ count: 1 }));
        expect(listener).not.toHaveBeenCalled();

        store.flush();
        expect(listener).toHaveBeenCalledTimes(1);
        expect(store.getSnapshot().count).toBe(1);

        store.flush();
        expect(listener).toHaveBeenCalledTimes(1);
    });

    it('keeps the snapshot identity and stays silent when no data field changed', () => {
        const list: number[] = [];
        const store = createAppStateStore(makeDemo({ list }));
        const listener = vi.fn();
        store.subscribe(listener);
        const before = store.getSnapshot();

        // Fresh closure, same data: the common "unrelated render" case.
        store.commit(makeDemo({ list, bump: () => 99 }));
        store.flush();

        expect(store.getSnapshot()).toBe(before);
        expect(listener).not.toHaveBeenCalled();
        expect(store.getSnapshot().bump()).toBe(99);
    });

    it('treats a new reference as a change even when contents are equal', () => {
        const store = createAppStateStore(makeDemo());
        const listener = vi.fn();
        store.subscribe(listener);

        store.commit(makeDemo({ list: [] }));
        store.flush();

        expect(listener).toHaveBeenCalledTimes(1);
    });

    it('stops notifying after unsubscribe', () => {
        const store = createAppStateStore(makeDemo());
        const listener = vi.fn();
        const unsubscribe = store.subscribe(listener);
        unsubscribe();

        store.commit(makeDemo({ count: 5 }));
        store.flush();

        expect(listener).not.toHaveBeenCalled();
    });
});

describe('shallowEqual', () => {
    it('compares one level deep', () => {
        const inner = { x: 1 };
        expect(shallowEqual({ a: 1, b: inner }, { a: 1, b: inner })).toBe(true);
        expect(shallowEqual({ a: 1, b: { x: 1 } }, { a: 1, b: { x: 1 } })).toBe(false);
    });

    it('rejects differing keys, including an undefined value against a missing key', () => {
        expect(shallowEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
        expect(shallowEqual({ a: undefined } as Record<string, unknown>, { b: undefined })).toBe(false);
    });

    it('handles primitives and null', () => {
        expect(shallowEqual(1, 1)).toBe(true);
        expect(shallowEqual(1, 2)).toBe(false);
        expect(shallowEqual(null, {})).toBe(false);
        expect(shallowEqual(NaN, NaN)).toBe(true);
    });
});
