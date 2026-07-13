/** Short tick via Web Audio when crossing a detent (opt-in per control). */
let sharedAudioContext: AudioContext | null = null;

export function playDetentTick(): void {
    if (typeof window === 'undefined') return;
    try {
        const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctx) return;
        if (!sharedAudioContext) sharedAudioContext = new Ctx();
        if (sharedAudioContext.state === 'suspended') {
            void sharedAudioContext.resume();
        }

        const osc = sharedAudioContext.createOscillator();
        const gain = sharedAudioContext.createGain();
        osc.type = 'sine';
        osc.frequency.value = 2800;
        const now = sharedAudioContext.currentTime;
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(0.06, now + 0.002);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.025);
        osc.connect(gain);
        gain.connect(sharedAudioContext.destination);
        osc.start(now);
        osc.stop(now + 0.03);
    } catch {
        // Audio may be blocked until user gesture — fail silently.
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
