import { SingingVoice, type SingingVoiceConfig } from './SingingVoice';
import { playbackHealthMonitor } from '../audio/playback/PlaybackHealthMonitor';
import { VoicePool } from './base/VoicePool';

export class SingingVoiceManager extends VoicePool<SingingVoice> {
    private audioContext: AudioContext;
    private loadedBanks: Map<number, string> = new Map();
    private config: SingingVoiceConfig;

    constructor(audioContext: AudioContext, maxVoices: number = 12, config: SingingVoiceConfig = {}) {
        super(maxVoices);
        this.audioContext = audioContext;
        this.config = {
            useHighQuality: false,
            preserveFormants: true,
            channels: 1,
            bufferSize: 16384,
            enablePhonemeStretching: true,
            ...config
        };
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
    acquireVoiceForBank(bankId: string): { voice: SingingVoice; index: number; isNewBank: boolean } {
        const result = this.acquire({ affinityKey: bankId, steal: 'oldest' });

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
     * Backward compatibility wrapper for old acquireVoice calls.
     */
    acquireVoice(): { voice: SingingVoice; index: number; isNewBank: boolean } {
        return this.acquireVoiceForBank('__unknown__');
    }

    /**
     * Register a voice as active.
     */
    registerActiveVoice(index: number, note: string, startTime: number) {
        this.markActive(index, startTime);
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
        if (outArray) {
            outArray.length = 0;
            for (const index of this.activeIndices) {
                outArray.push(this.voices[index]!);
            }
            return outArray;
        }
        return Array.from(this.activeIndices).map(index => this.voices[index]!);
    }

    override stopAll(time?: number) {
        super.stopAll(time ?? this.audioContext.currentTime);
    }
}
