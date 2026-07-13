/**
 * Central runtime degradation / fallback state for GPU, WASM, and audio worklets.
 * Complements engineTelemetry (metrics) and loadingProgressStore (boot sequence).
 */

import React from 'react';
import { loadingProgressStore } from './loadingProgressStore';

export type DegradationCategory = 'gpu' | 'wasm' | 'worklet' | 'audio';

export type DegradationStatus = 'active' | 'recovering' | 'resolved';

export interface DegradationIssue {
    /** Stable id, e.g. `gpu-knobs`, `open303`, `prophecy` */
    id: string;
    subsystem: string;
    category: DegradationCategory;
    /** User-facing headline */
    message: string;
    /** Technical reason (may be shown in tooltip / HUD) */
    reason: string;
    status: DegradationStatus;
    /** Active backend resolution when degraded */
    activeBackend: string;
    /** Preferred / requested backend */
    requestedBackend: string;
    retryable: boolean;
    updatedAt: number;
}

type DegradationListener = (issues: DegradationIssue[]) => void;
type RetryHandler = () => void | Promise<void>;

class EngineDegradationStore {
    private issues = new Map<string, DegradationIssue>();
    private listeners = new Set<DegradationListener>();
    private retryHandlers = new Map<string, RetryHandler>();
    private toastHandler: ((message: string, type?: 'info' | 'warning' | 'error') => void) | null = null;
    private lastToastAt = new Map<string, number>();
    private readonly TOAST_THROTTLE_MS = 8_000;

    subscribe(listener: DegradationListener): () => void {
        this.listeners.add(listener);
        listener(this.getIssues());
        return () => this.listeners.delete(listener);
    }

    setToastHandler(handler: ((message: string, type?: 'info' | 'warning' | 'error') => void) | null): void {
        this.toastHandler = handler;
    }

    registerRetryHandler(id: string, handler: RetryHandler): () => void {
        this.retryHandlers.set(id, handler);
        return () => this.retryHandlers.delete(id);
    }

    getIssues(): DegradationIssue[] {
        return Array.from(this.issues.values())
            .filter((i) => i.status !== 'resolved')
            .sort((a, b) => b.updatedAt - a.updatedAt);
    }

    getIssue(id: string): DegradationIssue | undefined {
        return this.issues.get(id);
    }

    report(issue: Omit<DegradationIssue, 'updatedAt'> & { updatedAt?: number }): void {
        const prev = this.issues.get(issue.id);
        const next: DegradationIssue = {
            ...issue,
            updatedAt: issue.updatedAt ?? Date.now(),
        };
        this.issues.set(issue.id, next);
        loadingProgressStore.recordRuntimeDegradation(next.subsystem, next.message, next.reason);
        this.notify();

        const isNew = !prev || prev.status === 'resolved';
        const reasonChanged = prev && prev.reason !== next.reason;
        if (isNew || reasonChanged) {
            this.maybeToast(next);
        }
    }

    setStatus(id: string, status: DegradationStatus): void {
        const existing = this.issues.get(id);
        if (!existing) return;
        this.issues.set(id, { ...existing, status, updatedAt: Date.now() });
        this.notify();
        if (status === 'resolved') {
            this.maybeToast({ ...existing, status, message: `${existing.subsystem}: recovered`, updatedAt: Date.now() }, 'info');
        }
    }

    resolve(id: string): void {
        this.setStatus(id, 'resolved');
    }

    clear(id: string): void {
        this.issues.delete(id);
        this.notify();
    }

    async retry(id: string): Promise<boolean> {
        const handler = this.retryHandlers.get(id);
        if (!handler) return false;
        const existing = this.issues.get(id);
        if (existing) {
            this.setStatus(id, 'recovering');
        }
        try {
            await handler();
            this.resolve(id);
            return true;
        } catch (err) {
            const reason = err instanceof Error ? err.message : String(err);
            if (existing) {
                this.report({ ...existing, status: 'active', reason, updatedAt: Date.now() });
            }
            return false;
        }
    }

    /** Bridge from logEngineFallback — maps subsystem strings to store entries. */
    reportEngineFallback(subsystem: string, requestedBackend: string, reason: string): void {
        const category: DegradationCategory =
            subsystem.includes('worklet') || subsystem === 'open303' || subsystem === 'prophecy' || subsystem === 'singingVoice'
                ? 'worklet'
                : subsystem.includes('gpu') || subsystem === 'webgpu' || subsystem === 'gpu-knobs'
                  ? 'gpu'
                  : subsystem.includes('wasm') || subsystem === 'rust' || subsystem === 'oscillators'
                    ? 'wasm'
                    : 'audio';

        this.report({
            id: subsystem,
            subsystem,
            category,
            message: `${subsystem} using JS fallback`,
            reason,
            status: 'active',
            activeBackend: 'js-fallback',
            requestedBackend,
            retryable: category !== 'audio',
        });
    }

    private maybeToast(issue: DegradationIssue, type: 'info' | 'warning' | 'error' = 'warning'): void {
        if (!this.toastHandler) return;
        const now = Date.now();
        const last = this.lastToastAt.get(issue.id) ?? 0;
        if (now - last < this.TOAST_THROTTLE_MS) return;
        this.lastToastAt.set(issue.id, now);
        const text =
            issue.status === 'resolved'
                ? issue.message
                : `${issue.message}${issue.reason ? ` (${issue.reason})` : ''}`;
        this.toastHandler(text, type);
    }

    private notify(): void {
        const issues = this.getIssues();
        this.listeners.forEach((l) => l(issues));
        if (typeof window !== 'undefined') {
            try {
                window.dispatchEvent(new CustomEvent('hyphon-degradation-change', { detail: { issues } }));
            } catch {
                /* tests */
            }
        }
    }
}

export const engineDegradationStore = new EngineDegradationStore();

export function useEngineDegradation(): DegradationIssue[] {
    const [issues, setIssues] = React.useState<DegradationIssue[]>(engineDegradationStore.getIssues());
    React.useEffect(() => engineDegradationStore.subscribe(setIssues), []);
    return issues;
}
