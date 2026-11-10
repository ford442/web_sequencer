/**
 * An in-memory BroadcastChannel stand-in: messages are structured-cloned and
 * delivered asynchronously to every other channel of the same name, like the
 * real one. `settle()` waits until nothing is in flight.
 */

import type { LocalChannel } from '../providers/local';

type Listener = (event: { data: unknown }) => void;

export interface ChannelHub {
    createChannel: (name: string) => LocalChannel;
    /** Messages posted so far (cloned), for inspection. */
    posted: unknown[];
    /** Deliver this raw message to every channel named `name`, as if a foreign tab sent it. */
    inject(name: string, data: unknown): void;
    settle(): Promise<void>;
}

export function createChannelHub(): ChannelHub {
    const channels = new Map<string, Set<{ listeners: Set<Listener> }>>();
    const posted: unknown[] = [];
    let inFlight = 0;

    const deliver = (targets: { listeners: Set<Listener> }[], data: unknown) => {
        inFlight++;
        setTimeout(() => {
            inFlight--;
            for (const target of targets) for (const listener of [...target.listeners]) listener({ data: structuredClone(data) });
        }, 0);
    };

    return {
        posted,
        createChannel(name) {
            const members = channels.get(name) ?? new Set();
            channels.set(name, members);
            const self = { listeners: new Set<Listener>() };
            members.add(self);
            return {
                postMessage(message) {
                    const data = structuredClone(message);
                    posted.push(data);
                    deliver([...members].filter((m) => m !== self), data);
                },
                addEventListener(_type, listener) {
                    self.listeners.add(listener);
                },
                removeEventListener(_type, listener) {
                    self.listeners.delete(listener);
                },
                close() {
                    members.delete(self);
                },
            };
        },
        inject(name, data) {
            deliver([...(channels.get(name) ?? [])], data);
        },
        async settle() {
            for (let i = 0; i < 100; i++) {
                await new Promise((resolve) => setTimeout(resolve, 0));
                if (inFlight === 0) return;
            }
            throw new Error('channel hub never settled');
        },
    };
}
