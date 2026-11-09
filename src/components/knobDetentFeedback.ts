import { audioRuntime } from '../audio/runtime/AudioRuntime';

/**
 * Short tick via Web Audio when crossing a detent (opt-in per control).
 * Plays on the engine's live context from the audio runtime — no second
 * AudioContext, clock or output path. Before the engine exists, or while its
 * context is not running, the tick is silent (the haptic still fires).
 */
export function playDetentTick(): void {
    const ctx = audioRuntime.context;
    if (!ctx || ctx.state !== 'running') return;
    try {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = 2800;
        const now = ctx.currentTime;
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(0.06, now + 0.002);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.025);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.03);
    } catch {
        // A context mid-teardown can throw on node creation — stay silent.
    }
}

/** Brief vibration pulse on supported devices. */
export function pulseDetentHaptic(): void {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        navigator.vibrate(6);
    }
}

export function notifyDetentCross(feedback: 'audio' | 'haptic' | 'both' = 'both'): void {
    if (feedback === 'audio' || feedback === 'both') playDetentTick();
    if (feedback === 'haptic' || feedback === 'both') pulseDetentHaptic();
}

/**
 * Returns the index of the detent currently snapped-to, or null if between detents.
 * Uses half the snap threshold so feedback fires on entry, not while hovering.
 */
export function snappedDetentIndex(
    normalized: number,
    positions: number[],
    snapThreshold: number
): number | null {
    const enterThreshold = snapThreshold * 0.55;
    for (let i = 0; i < positions.length; i++) {
        if (Math.abs(normalized - positions[i]) <= enterThreshold) {
            return i;
        }
    }
    return null;
}
