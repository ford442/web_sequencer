import { SingingVoice, type SingingVoiceConfig } from './SingingVoice';
import { playbackHealthMonitor } from '../audio/playback/PlaybackHealthMonitor';
import { VoicePool } from './base/VoicePool';
import {
    BASS_TRIGGER_STRIDE,
    DRUM_TRIGGER_STRIDE,
    SidechainRingWriter,
    createSidechainRing,
} from '../shared/rt/sidechainTriggerRing';

export class SingingVoiceManager extends VoicePool<SingingVoice> {
    private audioContext: BaseAudioContext;
    private loadedBanks: Map<number, string> = new Map();
    private config: SingingVoiceConfig;
    private drumSidechainSAB: SharedArrayBuffer;
    private bassSidechainSAB: SharedArrayBuffer;
    private readonly drumTriggers: SidechainRingWriter;
    private readonly bassTriggers: SidechainRingWriter;
    private readonly drumEvent = new Float64Array(DRUM_TRIGGER_STRIDE);
    private readonly bassEvent = new Float64Array(BASS_TRIGGER_STRIDE);

    constructor(audioContext: BaseAudioContext, maxVoices: number = 12, config: SingingVoiceConfig = {}) {
        super(maxVoices);
        this.audioContext = audioContext;
        // Trigger rings, not single slots: notes are written ahead of the clock (shared/rt/sidechainTriggerRing.ts).
        this.drumSidechainSAB = createSidechainRing(DRUM_TRIGGER_STRIDE);
        this.bassSidechainSAB = createSidechainRing(BASS_TRIGGER_STRIDE);
        this.drumTriggers = new SidechainRingWriter(this.drumSidechainSAB);
        this.bassTriggers = new SidechainRingWriter(this.bassSidechainSAB);
        this.config = {
            useHighQuality: false,
            preserveFormants: true,
            channels: 1,
            bufferSize: 16384,
            enablePhonemeStretching: true,
            drumSidechainSAB: this.drumSidechainSAB,
            bassSidechainSAB: this.bassSidechainSAB,
            ...config
        };
    }

    public getDrumSidechainSAB(): SharedArrayBuffer {
        return this.drumSidechainSAB;
    }

    public getBassSidechainSAB(): SharedArrayBuffer {
        return this.bassSidechainSAB;
    }

    /** Queues a kick/snare hit for the granulator's drum duck. Velocity is clamped to 0..1. */
    public pushDrumTrigger(time: number, velocity: number, decaySeconds: number, isSnare: boolean): void {
        const e = this.drumEvent;
        e[0] = time;
        e[1] = clamp01(velocity);
        e[2] = decaySeconds > 0 ? decaySeconds : 0.25;
        e[3] = isSnare ? 1 : 0;
        this.drumTriggers.push(e);
    }

    /** Queues a root-bass note for the bass envelope follower. Velocity is clamped to 0..1. */
    public pushBassTrigger(time: number, velocity: number, durationSeconds: number): void {
        const e = this.bassEvent;
        e[0] = time;
        e[1] = clamp01(velocity);
        e[2] = durationSeconds > 0 ? durationSeconds : 0;
        this.bassTriggers.push(e);
    }

    async init(
        wasmBinary?: ArrayBuffer,
        onVoiceReady?: (done: number, total: number) => void,
    ): Promise<void> {
        let done = 0;
        const initPromises: Promise<void>[] = [];
        for (let i = 0; i < this.maxVoices; i++) {
            const voice = new SingingVoice(this.audioContext, this.config);
            this.voices.push(voice);
            initPromises.push(
                voice.initWorklet(false, wasmBinary).then(() => {
                    done += 1;
                    onVoiceReady?.(done, this.maxVoices);
                })
            );
        }

        await Promise.all(initPromises);
        console.log(`SingingVoiceManager: Initialized ${this.maxVoices} voices`);
    }

    /**
     * Acquire a free voice or steal the oldest one.
     * Prioritizes voices that already have the requested bank loaded to avoid redundant buffer transfers.
     * @returns The allocated SingingVoice, its index, and whether a new bank load is required.
     */
    protected override getAffinityKey(index: number): string | undefined {
        return this.loadedBanks.get(index);
    }

    protected override onStolen(voice: SingingVoice, index: number, time?: number): void {
        super.onStolen(voice, index, time);
        playbackHealthMonitor.recordVoiceSteal('singingVoice');
    }

    protected override stopVoice(voice: SingingVoice, time?: number): void {
        voice.noteOff(time ?? this.audioContext.currentTime);
    }


    /**
     * Acquire a free voice or steal the oldest one.
     * Prioritizes voices that already have the requested bank loaded to avoid redundant buffer transfers.
     * @returns The allocated SingingVoice, its index, and whether a new bank load is required.
     */
    acquireVoiceForBank(bankId: string, time?: number): { voice: SingingVoice; index: number; isNewBank: boolean } {
        const result = this.acquire({ affinityKey: bankId, steal: 'oldest', time });
        this.markActive(result.index, time);

        if (!result.affinityHit) {
            this.loadedBanks.set(result.index, bankId);
        }

        return {
            voice: result.voice,
            index: result.index,
            isNewBank: !result.affinityHit
        };
    }

    /**
     * Register a voice as active explicitly (used by playback hooks).
     * Note: This is largely redundant now that acquireVoiceForBank calls markActive directly,
     * but retained for backward compatibility with older sequencer patterns.
     */
    registerActiveVoice(index: number, noteId: string, time?: number): void {
        this.markActive(index, time);
    }

    /**
     * Backward compatibility wrapper for old acquireVoice calls.
     */
    acquireVoice(time?: number): { voice: SingingVoice; index: number; isNewBank: boolean } {
        return this.acquireVoiceForBank('__unknown__', time);
    }

    /**
     * Release a specific voice index.
     */
    releaseVoice(index: number) {
        this.markInactive(index);
    }

    /**
     * Get a specific voice by index (for direct access like params update)
     */
    getVoice(index: number): SingingVoice | undefined {
        return this.voices[index];
    }

    /**
     * Get currently active voices.
     * @param outArray Optional array to populate, avoiding transient array allocation.
     */
    getActiveVoices(outArray?: SingingVoice[]): SingingVoice[] {
        const result = outArray || new Array(this.activeIndices.size);
        if (outArray) {
            outArray.length = 0;
        }

        let i = 0;
        for (const index of this.activeIndices) {
            if (outArray) {
                result.push(this.voices[index]!);
            } else {
                result[i++] = this.voices[index]!;
            }
        }
        return result as SingingVoice[];
    }

    override stopAll(time?: number) {
        super.stopAll(time ?? this.audioContext.currentTime);
    }
}

function clamp01(v: number): number {
    return v > 0 ? (v < 1 ? v : 1) : 0;
}
