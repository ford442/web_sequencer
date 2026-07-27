/**
 * Shared motion preference for holographic knobs.
 *
 * Idle knobs and prefers-reduced-motion share the same static-frame path:
 * the time uniform is locked to KNOB_STATIC_TIME (see resolveKnobTimeUniform).
 */

import { KNOB_STATIC_TIME } from './knobMaterial';

type ReducedMotionListener = (reduced: boolean) => void;

const listeners = new Set<ReducedMotionListener>();
let mediaQuery: MediaQueryList | null = null;
let reducedMotion = false;
let listening = false;

function readReducedMotion(): boolean {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
        return false;
    }
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function ensureListener(): void {
    if (listening || typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
        return;
    }
    listening = true;
    mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    reducedMotion = mediaQuery.matches;
    const onChange = (event: MediaQueryListEvent) => {
        reducedMotion = event.matches;
        listeners.forEach((listener) => listener(reducedMotion));
    };
    // Safari < 14 used addListener; prefer the modern API when available.
    if (typeof mediaQuery.addEventListener === 'function') {
        mediaQuery.addEventListener('change', onChange);
    } else {
        mediaQuery.addListener(onChange);
    }
}

/** Whether the user prefers reduced motion (live; honors matchMedia changes). */
export function getPrefersReducedMotion(): boolean {
    ensureListener();
    if (!listening) return readReducedMotion();
    return reducedMotion;
}

/** Subscribe to prefers-reduced-motion changes. Returns an unsubscribe function. */
export function subscribeReducedMotion(listener: ReducedMotionListener): () => void {
    ensureListener();
    listeners.add(listener);
    listener(getPrefersReducedMotion());
    return () => {
        listeners.delete(listener);
    };
}

/**
 * Resolve the holographic time uniform for a frame.
 * Static (idle or reduced-motion) locks to KNOB_STATIC_TIME — identical code path.
 */
export function resolveKnobTimeUniform(
    nowSeconds: number,
    animated: boolean,
    prefersReduced = getPrefersReducedMotion(),
): number {
    if (prefersReduced || !animated) return KNOB_STATIC_TIME;
    return nowSeconds;
}

/** True when this knob should advance its animation time uniform. */
export function shouldAnimateKnob(animated: boolean): boolean {
    return animated && !getPrefersReducedMotion();
}
