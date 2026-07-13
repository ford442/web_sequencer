/**
 * Expression LED store — per-instrument note color + trigger envelope.
 *
 * Brightness is driven by a combination of AnalyserNode RMS (when wired) and
 * a decaying envelope bumped on each note/drum trigger.
 */

import type { ExpressionLedTarget } from '../types';

export type { ExpressionLedTarget };

export interface ExpressionLedChannel {
    noteColor: string;
    envelope: number;
}

type Listener = () => void;

const DECAY_PER_FRAME = 0.88;
const MIN_ENVELOPE = 0.02;

class ExpressionLedStore {
    private channels = new Map<ExpressionLedTarget, ExpressionLedChannel>();
    private listeners = new Set<Listener>();

    pulse(target: ExpressionLedTarget, noteColor: string, envelope = 1): void {
        this.channels.set(target, {
            noteColor,
            envelope: Math.max(0, Math.min(1, envelope)),
        });
        this.notify();
    }

    /** Decay envelopes — call once per animation frame. */
    tick(): void {
        let changed = false;
        for (const [target, channel] of this.channels) {
            const next = channel.envelope * DECAY_PER_FRAME;
            if (next < MIN_ENVELOPE) {
                this.channels.delete(target);
                changed = true;
            } else if (next !== channel.envelope) {
                channel.envelope = next;
                changed = true;
            }
        }
        if (changed) this.notify();
    }

    getChannel(target: ExpressionLedTarget): ExpressionLedChannel | undefined {
        return this.channels.get(target);
    }

    subscribe(listener: Listener): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    private notify(): void {
        for (const listener of this.listeners) listener();
    }
}

export const expressionLedStore = new ExpressionLedStore();
