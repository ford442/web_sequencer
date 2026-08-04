export type StealPolicy = 'round-robin' | 'oldest';

export interface AcquireOptions {
    affinityKey?: string;
    steal?: StealPolicy;
    time?: number;
}

export interface AcquireResult<T> {
    voice: T;
    index: number;
    stole: boolean;
    affinityHit: boolean;
}

export interface PoolableVoice {
    isActive: boolean;
}

export abstract class VoicePool<TVoice extends PoolableVoice> {
    protected voices: TVoice[] = [];
    protected maxVoices: number;

    protected activeIndices: Set<number> = new Set();
    protected startTimes: Map<number, number> = new Map();
    protected roundRobinIndex: number = 0;

    constructor(maxVoices: number) {
        this.maxVoices = Math.max(1, maxVoices);
    }

    /**
     * Get all voices in the pool (active or inactive).
     */
    public getAllVoices(): TVoice[] {
        return this.voices;
    }

    /**
     * Core allocation logic. Finds an idle voice, optionally matching an affinity key,
     * or steals one based on the specified policy.
     */
    protected acquire(options: AcquireOptions = {}): AcquireResult<TVoice> {
        const { affinityKey, steal = 'round-robin', time } = options;

        // 1. Find free voice with affinity match
        if (affinityKey !== undefined) {
            for (let i = 0; i < this.maxVoices; i++) {
                if (!this.activeIndices.has(i)) {
                    if (this.getAffinityKey(i) === affinityKey) {
                        return { voice: this.voices[i]!, index: i, stole: false, affinityHit: true };
                    }
                }
            }
        }

        // 2. Find any free voice
        for (let i = 0; i < this.maxVoices; i++) {
            // For round-robin, we check starting from the roundRobinIndex
            const checkIndex = steal === 'round-robin'
                ? (this.roundRobinIndex + i) % this.maxVoices
                : i;

            if (!this.activeIndices.has(checkIndex)) {
                if (steal === 'round-robin') {
                    this.roundRobinIndex = (checkIndex + 1) % this.maxVoices;
                }
                return { voice: this.voices[checkIndex]!, index: checkIndex, stole: false, affinityHit: false };
            }
        }

        // 3. Steal
        let victimIndex = 0;

        if (steal === 'oldest') {
            let oldestTime = Infinity;
            victimIndex = -1;

            for (const index of this.activeIndices) {
                const startTime = this.startTimes.get(index) ?? Infinity;
                if (startTime < oldestTime) {
                    oldestTime = startTime;
                    victimIndex = index;
                }
            }
            if (victimIndex === -1) victimIndex = 0; // Fallback
        } else {
            // round-robin steal
            victimIndex = this.roundRobinIndex;
            this.roundRobinIndex = (this.roundRobinIndex + 1) % this.maxVoices;
        }

        const victimVoice = this.voices[victimIndex]!;

        // Trigger steal hook
        this.onStolen(victimVoice, victimIndex, time);

        // Ensure it's removed from active set
        this.markInactive(victimIndex);

        return { voice: victimVoice, index: victimIndex, stole: true, affinityHit: false };
    }

    /**
     * Mark a voice as active.
     */
    protected markActive(index: number, startTime: number = 0): void {
        this.activeIndices.add(index);
        this.startTimes.set(index, startTime);
    }

    /**
     * Mark a voice as inactive.
     */
    protected markInactive(index: number): void {
        this.activeIndices.delete(index);
        this.startTimes.delete(index);
    }

    /**
     * Stop all active voices immediately.
     */
    public stopAll(time?: number): void {
        const indices = Array.from(this.activeIndices);
        for (const index of indices) {
            this.stopVoice(this.voices[index]!, time);
            this.markInactive(index);
        }
    }

    // --- Hooks ---

    /**
     * Optional: Return the current affinity key (e.g. loaded bank ID) for a slot.
     */
    protected getAffinityKey(index: number): string | undefined {
        return undefined;
    }

    /**
     * Hook called when a voice is stolen.
     */
    protected onStolen(voice: TVoice, index: number, time?: number): void {
        this.stopVoice(voice, time);
    }

    /**
     * Adapter to stop a voice.
     */
    protected abstract stopVoice(voice: TVoice, time?: number): void;
}
