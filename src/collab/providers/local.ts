/**
 * The `local` collab provider (#1597 P1): syncs a doc with every other doc in
 * the same BroadcastChannel room — other tabs and windows of this origin on
 * this device. No server, no network; also the provider tests run on.
 *
 * Protocol (structured-clone messages, `v` = PROTOCOL_VERSION):
 *
 *   hello  { from, sv }            joining: "here is my state vector"
 *   state  { from, to, update, sv } reply to a hello: what `to` is missing, plus
 *                                  my state vector so `to` can send back what I
 *                                  am missing (a reply to a reply has `sv: null`)
 *   update { from, update }        an edit made here, as it happens
 *   bye    { from }                leaving
 *
 * `from`/`to` are doc client ids. A channel never hears its own messages.
 */

import * as Y from 'yjs';
import type { CollabProvider, CollabProviderStatus } from './types';

export const PROTOCOL_VERSION = 1;
const CHANNEL_PREFIX = 'hyphon-collab:';

type LocalMessage =
    | { v: typeof PROTOCOL_VERSION; t: 'hello'; from: number; sv: Uint8Array }
    | { v: typeof PROTOCOL_VERSION; t: 'state'; from: number; to: number; update: Uint8Array; sv: Uint8Array | null }
    | { v: typeof PROTOCOL_VERSION; t: 'update'; from: number; update: Uint8Array }
    | { v: typeof PROTOCOL_VERSION; t: 'bye'; from: number };

/** The part of `BroadcastChannel` the provider uses (tests pass a fake). */
export interface LocalChannel {
    postMessage(message: unknown): void;
    addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
    removeEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
    close(): void;
}

export interface LocalProviderOptions {
    room: string;
    /** Defaults to `new BroadcastChannel(name)`. */
    createChannel?: (name: string) => LocalChannel;
}

function isBytes(value: unknown): value is Uint8Array {
    return value instanceof Uint8Array;
}

function isId(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value);
}

/** The message, or null for anything this version does not speak. */
function parseMessage(data: unknown): LocalMessage | null {
    if (data === null || typeof data !== 'object') return null;
    const m = data as Record<string, unknown>;
    if (m.v !== PROTOCOL_VERSION || !isId(m.from)) return null;
    switch (m.t) {
        case 'hello':
            return isBytes(m.sv) ? (m as LocalMessage) : null;
        case 'state':
            return isId(m.to) && isBytes(m.update) && (m.sv === null || isBytes(m.sv)) ? (m as LocalMessage) : null;
        case 'update':
            return isBytes(m.update) ? (m as LocalMessage) : null;
        case 'bye':
            return m as LocalMessage;
        default:
            return null;
    }
}

/** An update that carries no structs and no deletions. */
function isEmptyUpdate(update: Uint8Array): boolean {
    return update.byteLength <= 2 && update.every((byte) => byte === 0);
}

class LocalProvider implements CollabProvider {
    readonly kind = 'local' as const;
    readonly room: string;
    status: CollabProviderStatus = 'connected';
    synced = false;

    private readonly doc: Y.Doc;
    private readonly channel: LocalChannel;
    private readonly peerIds = new Set<number>();
    private readonly listeners = new Set<() => void>();
    private readonly syncWaiters = new Set<(synced: boolean) => void>();

    constructor(doc: Y.Doc, options: LocalProviderOptions) {
        this.doc = doc;
        this.room = options.room;
        const create = options.createChannel ?? ((name: string) => new BroadcastChannel(name) as LocalChannel);
        this.channel = create(CHANNEL_PREFIX + options.room);
        this.channel.addEventListener('message', this.onMessage);
        doc.on('update', this.onDocUpdate);
        this.post({ v: PROTOCOL_VERSION, t: 'hello', from: doc.clientID, sv: Y.encodeStateVector(doc) });
    }

    peers(): number[] {
        return [...this.peerIds];
    }

    whenSynced(timeoutMs: number): Promise<boolean> {
        if (this.synced) return Promise.resolve(true);
        if (this.status === 'disconnected') return Promise.resolve(false);
        return new Promise((resolve) => {
            const finish = (synced: boolean) => {
                clearTimeout(timer);
                this.syncWaiters.delete(finish);
                resolve(synced);
            };
            const timer = setTimeout(() => finish(false), timeoutMs);
            this.syncWaiters.add(finish);
        });
    }

    subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    destroy(): void {
        if (this.status === 'disconnected') return;
        this.post({ v: PROTOCOL_VERSION, t: 'bye', from: this.doc.clientID });
        this.doc.off('update', this.onDocUpdate);
        this.channel.removeEventListener('message', this.onMessage);
        this.channel.close();
        this.status = 'disconnected';
        this.peerIds.clear();
        for (const finish of [...this.syncWaiters]) finish(this.synced);
        this.emit();
    }

    private post(message: LocalMessage): void {
        if (this.status === 'connected') this.channel.postMessage(message);
    }

    private emit(): void {
        for (const listener of [...this.listeners]) listener();
    }

    private seePeer(id: number): void {
        if (this.peerIds.has(id)) return;
        this.peerIds.add(id);
        this.emit();
    }

    private markSynced(): void {
        if (this.synced) return;
        this.synced = true;
        for (const finish of [...this.syncWaiters]) finish(true);
        this.emit();
    }

    private apply(update: Uint8Array): void {
        try {
            Y.applyUpdate(this.doc, update, this);
        } catch (err) {
            // A peer on an incompatible build; its edits cannot be merged here.
            console.warn('[collab] dropped an update this doc cannot apply', err);
        }
    }

    private readonly onDocUpdate = (update: Uint8Array, origin: unknown): void => {
        if (origin === this) return;
        this.post({ v: PROTOCOL_VERSION, t: 'update', from: this.doc.clientID, update });
    };

    private readonly onMessage = (event: { data: unknown }): void => {
        const message = parseMessage(event.data);
        const self = this.doc.clientID;
        if (!message || message.from === self || this.status === 'disconnected') return;
        switch (message.t) {
            case 'hello':
                this.seePeer(message.from);
                this.post({
                    v: PROTOCOL_VERSION,
                    t: 'state',
                    from: self,
                    to: message.from,
                    update: Y.encodeStateAsUpdate(this.doc, message.sv),
                    sv: Y.encodeStateVector(this.doc),
                });
                break;
            case 'state': {
                if (message.to !== self) break;
                this.seePeer(message.from);
                this.apply(message.update);
                if (message.sv) {
                    const missing = Y.encodeStateAsUpdate(this.doc, message.sv);
                    if (!isEmptyUpdate(missing)) {
                        this.post({ v: PROTOCOL_VERSION, t: 'state', from: self, to: message.from, update: missing, sv: null });
                    }
                }
                this.markSynced();
                break;
            }
            case 'update':
                this.seePeer(message.from);
                this.apply(message.update);
                break;
            case 'bye':
                if (this.peerIds.delete(message.from)) this.emit();
                break;
        }
    };
}

/** Join `options.room` with `doc` over BroadcastChannel. */
export function createLocalProvider(doc: Y.Doc, options: LocalProviderOptions): CollabProvider {
    return new LocalProvider(doc, options);
}
