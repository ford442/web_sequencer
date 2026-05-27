/**
 * ProphecyManager.ts
 *
 * Manages two ProphecyOscillator instances:
 *   - partA: SYNTH A / LEAD voice
 *   - partB: SYNTH B / BASS voice
 *
 * Mirrors the structure of Open303Manager so the routing code can
 * follow the same patterns.
 */

import { ProphecyOscillator } from './ProphecyOscillator';
import type { SynthParams } from '../types';
import { PROPHECY_WAVEFORM_ID } from './ProphecyParams';

export class ProphecyManager {
    private partA: ProphecyOscillator | null = null;
    private partB: ProphecyOscillator | null = null;

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    /**
     * Initialize both Prophecy instances.
     *
     * The browser de-dupes `addModule` calls for the same URL so both
     * instances share a single worklet load.
     */
    async init(audioContext: AudioContext, workletUrl: string): Promise<boolean> {
        this.partA = new ProphecyOscillator();
        this.partB = new ProphecyOscillator();

        const results = await Promise.allSettled([
            this.partA.init(audioContext, workletUrl),
            this.partB.init(audioContext, workletUrl),
        ]);

        const [aResult, bResult] = results;
        const aReady = aResult.status === 'fulfilled' && aResult.value;
        const bReady = bResult.status === 'fulfilled' && bResult.value;

        if (!aReady) console.warn('[ProphecyManager] partA init failed');
        if (!bReady) console.warn('[ProphecyManager] partB init failed');

        return aReady || bReady;
    }

    /** Connect both instances to a downstream audio node (e.g. master bus). */
    connect(dest: AudioNode): void {
        this.partA?.connect(dest);
        this.partB?.connect(dest);
    }

    /** Disconnect both instances. */
    disconnect(): void {
        this.partA?.disconnect();
        this.partB?.disconnect();
    }

    // ── Readiness ─────────────────────────────────────────────────────────────

    isPartAReady(): boolean { return this.partA?.isReady ?? false; }
    isPartBReady(): boolean { return this.partB?.isReady ?? false; }

    // ── Parameter application ─────────────────────────────────────────────────

    /**
     * Apply SynthParams to a Prophecy instance.
     *
     * @param osc       The target ProphecyOscillator.
     * @param params    Current SynthParams from the UI.
     * @param waveType  Waveform suffix extracted from the Waveform value
     *                  ('saw' | 'sqr' | 'tri' | 'pulse').
     */
    private static applyParams(
        osc: ProphecyOscillator,
        params: SynthParams,
        waveType: string,
    ): void {
        osc.setWaveform(PROPHECY_WAVEFORM_ID[waveType] ?? 0);
        osc.setVolume(params.volume);
        // Map ADSR: UI values are in seconds/levels; Prophecy params are 0-1
        osc.setAttack(Math.max(0, Math.min(1, params.attack / 2)));
        osc.setDecay(Math.max(0, Math.min(1, params.decay / 2)));
        osc.setSustain(Math.max(0, Math.min(1, params.sustain)));
        osc.setRelease(Math.max(0, Math.min(1, params.release / 3)));
        // Map filterResonance (0-20) → Prophecy RESONANCE (0-1, inverted: high Q = low value)
        osc.setResonance(Math.max(0, Math.min(1, 1 - params.filterResonance / 20)));
    }

    applyPartAParams(params: SynthParams, waveType: string): void {
        if (this.partA) ProphecyManager.applyParams(this.partA, params, waveType);
    }

    applyPartBParams(params: SynthParams, waveType: string): void {
        if (this.partB) ProphecyManager.applyParams(this.partB, params, waveType);
    }

    // ── Note control ─────────────────────────────────────────────────────────

    noteOnPartA(midiNote: number, velocity: number = 100): void {
        this.partA?.noteOn(midiNote, velocity);
    }

    noteOffPartA(midiNote: number): void {
        this.partA?.noteOff(midiNote);
    }

    noteOnPartB(midiNote: number, velocity: number = 100): void {
        this.partB?.noteOn(midiNote, velocity);
    }

    noteOffPartB(midiNote: number): void {
        this.partB?.noteOff(midiNote);
    }

    allNotesOff(): void {
        this.partA?.allNotesOff();
        this.partB?.allNotesOff();
    }

    // ── Cleanup ───────────────────────────────────────────────────────────────

    cleanup(): void {
        this.partA?.cleanup();
        this.partB?.cleanup();
        this.partA = null;
        this.partB = null;
    }
}
