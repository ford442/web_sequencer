import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { PROTOCOL_VERSION, createLocalProvider } from '../providers/local';
import type { CollabProvider } from '../providers/types';
import { createChannelHub, type ChannelHub } from './channelHub';

const ROOM = 'project:test';
const CHANNEL = `hyphon-collab:${ROOM}`;

let providers: CollabProvider[] = [];

afterEach(() => {
    for (const provider of providers) provider.destroy();
    providers = [];
});

function join(hub: ChannelHub, doc = new Y.Doc(), room = ROOM): { doc: Y.Doc; provider: CollabProvider } {
    const provider = createLocalProvider(doc, { room, createChannel: hub.createChannel });
    providers.push(provider);
    return { doc, provider };
}

const text = (doc: Y.Doc) => doc.getText('t').toJSON();

describe('local (BroadcastChannel) provider', () => {
    it('a tab that joins later receives the whole doc, and sends what it had', async () => {
        const hub = createChannelHub();
        const a = join(hub);
        a.doc.getText('t').insert(0, 'from a. ');
        const late = new Y.Doc();
        late.getMap('m').set('k', 'from late');
        const b = join(hub, late);
        await hub.settle();
        expect(text(b.doc)).toBe('from a. ');
        expect(a.doc.getMap('m').get('k')).toBe('from late');
        expect(b.provider.synced).toBe(true);
        expect(a.provider.peers()).toEqual([b.doc.clientID]);
        expect(b.provider.peers()).toEqual([a.doc.clientID]);
    });

    it('relays edits live in both directions and converges on concurrent ones', async () => {
        const hub = createChannelHub();
        const a = join(hub);
        const b = join(hub);
        const c = join(hub);
        await hub.settle();
        a.doc.getText('t').insert(0, 'A');
        b.doc.getText('t').insert(0, 'B');
        c.doc.getMap('m').set('c', 1);
        await hub.settle();
        expect(text(a.doc)).toBe(text(b.doc));
        expect(text(a.doc)).toBe(text(c.doc));
        expect(text(a.doc).split('').sort().join('')).toBe('AB');
        expect(b.doc.getMap('m').get('c')).toBe(1);
    });

    it('does not echo remote updates back into the room', async () => {
        const hub = createChannelHub();
        const a = join(hub);
        join(hub);
        await hub.settle();
        hub.posted.length = 0;
        a.doc.getText('t').insert(0, 'x');
        await hub.settle();
        const updates = hub.posted.filter((m) => (m as { t: string }).t === 'update');
        expect(updates).toHaveLength(1);
    });

    it('applies remote updates with the provider as origin', async () => {
        const hub = createChannelHub();
        const a = join(hub);
        const b = join(hub);
        await hub.settle();
        const origins: unknown[] = [];
        b.doc.on('update', (_u: Uint8Array, origin: unknown) => origins.push(origin));
        a.doc.getText('t').insert(0, 'x');
        await hub.settle();
        expect(origins).toEqual([b.provider]);
    });

    it('keeps rooms apart', async () => {
        const hub = createChannelHub();
        const a = join(hub, new Y.Doc(), 'room-1');
        const b = join(hub, new Y.Doc(), 'room-2');
        a.doc.getText('t').insert(0, 'secret');
        await hub.settle();
        expect(text(b.doc)).toBe('');
        expect(a.provider.peers()).toEqual([]);
    });

    it('whenSynced: true once a peer answers, false when alone', async () => {
        const hub = createChannelHub();
        const alone = join(hub);
        await expect(alone.provider.whenSynced(20)).resolves.toBe(false);
        const b = join(hub);
        await expect(b.provider.whenSynced(1000)).resolves.toBe(true);
        await expect(b.provider.whenSynced(0)).resolves.toBe(true);
    });

    it('notifies subscribers, and forgets a peer that says bye', async () => {
        const hub = createChannelHub();
        const a = join(hub);
        const listener = vi.fn();
        a.provider.subscribe(listener);
        const b = join(hub);
        await hub.settle();
        expect(listener).toHaveBeenCalled();
        expect(a.provider.peers()).toHaveLength(1);
        b.provider.destroy();
        await hub.settle();
        expect(a.provider.peers()).toEqual([]);
    });

    it('stops sending and receiving once destroyed', async () => {
        const hub = createChannelHub();
        const a = join(hub);
        const b = join(hub);
        await hub.settle();
        a.provider.destroy();
        expect(a.provider.status).toBe('disconnected');
        a.doc.getText('t').insert(0, 'after');
        b.doc.getText('t').insert(0, 'other');
        await hub.settle();
        expect(text(b.doc)).toBe('other');
        expect(text(a.doc)).toBe('after');
        await expect(a.provider.whenSynced(10)).resolves.toBe(false);
    });

    it('ignores messages from other protocol versions and malformed ones', async () => {
        const hub = createChannelHub();
        const a = join(hub);
        await hub.settle();
        const foreign = new Y.Doc();
        foreign.getText('t').insert(0, 'nope');
        const update = Y.encodeStateAsUpdate(foreign);
        hub.inject(CHANNEL, { v: PROTOCOL_VERSION + 1, t: 'update', from: 42, update });
        hub.inject(CHANNEL, { v: PROTOCOL_VERSION, t: 'update', from: 'x', update });
        hub.inject(CHANNEL, { v: PROTOCOL_VERSION, t: 'update', from: 43, update: 'bytes?' });
        hub.inject(CHANNEL, null);
        hub.inject(CHANNEL, 'hello');
        await hub.settle();
        expect(text(a.doc)).toBe('');
        expect(a.provider.peers()).toEqual([]);
    });

    it('survives an update it cannot apply', async () => {
        const hub = createChannelHub();
        const a = join(hub);
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        hub.inject(CHANNEL, { v: PROTOCOL_VERSION, t: 'update', from: 7, update: Uint8Array.from([9, 9, 9, 9]) });
        await hub.settle();
        a.doc.getText('t').insert(0, 'still fine');
        expect(text(a.doc)).toBe('still fine');
        warn.mockRestore();
    });

    it.runIf(typeof BroadcastChannel === 'function')('works over a real BroadcastChannel', async () => {
        const a = new Y.Doc();
        const b = new Y.Doc();
        const pa = createLocalProvider(a, { room: `real-${Math.random()}` });
        providers.push(pa);
        const pb = createLocalProvider(b, { room: pa.room });
        providers.push(pb);
        a.getText('t').insert(0, 'over the wire');
        await expect(pb.whenSynced(2000)).resolves.toBe(true);
        await vi.waitFor(() => expect(text(b)).toBe('over the wire'));
    });
});
