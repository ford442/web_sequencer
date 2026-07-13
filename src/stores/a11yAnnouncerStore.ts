/**
 * Screen-reader announcements for transport, playhead, and mode changes.
 */

import React from 'react';

export type A11yPoliteness = 'polite' | 'assertive';

export interface A11yAnnouncement {
    message: string;
    politeness: A11yPoliteness;
    id: number;
}

type Listener = (announcement: A11yAnnouncement | null) => void;

class A11yAnnouncerStore {
    private listeners = new Set<Listener>();
    private current: A11yAnnouncement | null = null;
    private nextId = 0;
    private lastMessage = '';
    private lastAt = 0;
    private readonly THROTTLE_MS = 400;

    subscribe(listener: Listener): () => void {
        this.listeners.add(listener);
        listener(this.current);
        return () => this.listeners.delete(listener);
    }

    announce(message: string, politeness: A11yPoliteness = 'polite'): void {
        const trimmed = message.trim();
        if (!trimmed) return;
        const now = Date.now();
        if (trimmed === this.lastMessage && now - this.lastAt < this.THROTTLE_MS) return;
        this.lastMessage = trimmed;
        this.lastAt = now;
        this.current = { message: trimmed, politeness, id: ++this.nextId };
        this.listeners.forEach((l) => l(this.current));
    }

    clear(): void {
        this.current = null;
        this.listeners.forEach((l) => l(null));
    }
}

export const a11yAnnouncerStore = new A11yAnnouncerStore();

export function useA11yAnnouncer(): A11yAnnouncement | null {
    const [announcement, setAnnouncement] = React.useState<A11yAnnouncement | null>(null);
    React.useEffect(() => a11yAnnouncerStore.subscribe(setAnnouncement), []);
    return announcement;
}
