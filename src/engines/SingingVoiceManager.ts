import { SingingVoice, type SingingVoiceConfig } from './SingingVoice';
import { playbackHealthMonitor } from '../audio/playback/PlaybackHealthMonitor';

interface ActiveVoice {
    voice: SingingVoice;
    note: string;
    startTime: number;
    source?: AudioBufferSourceNode; // For fallback mode
}

export class SingingVoiceManager {
    private audioContext: AudioContext;
    private voices: SingingVoice[] = [];
    private activeVoices: Map<number, ActiveVoice> = new Map();
    private loadedBanks: Map<number, string> = new Map();
    private config: SingingVoiceConfig;
    private maxVoices: number;

    constructor(audioContext: AudioContext, maxVoices: number = 12, config: SingingVoiceConfig = {}) {
        this.audioContext = audioContext;
        this.maxVoices = maxVoices;
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
    acquireVoiceForBank(bankId: string): { voice: SingingVoice; index: number; isNewBank: boolean } {
        const activeIndices = new Set(this.activeVoices.keys());

        // 1. Find a free voice that already has this bank loaded
        for (let i = 0; i < this.maxVoices; i++) {
            if (!activeIndices.has(i) && this.loadedBanks.get(i) === bankId) {
                return { voice: this.voices[i], index: i, isNewBank: false };
            }
        }

        // 2. Find any free voice
        for (let i = 0; i < this.maxVoices; i++) {
            if (!activeIndices.has(i)) {
                this.loadedBanks.set(i, bankId);
                return { voice: this.voices[i], index: i, isNewBank: true };
            }
        }

        // 3. Steal oldest voice
        let oldestTime = Infinity;
        let oldestIndex = -1;

        this.activeVoices.forEach((v, index) => {
            if (v.startTime < oldestTime) {
                oldestTime = v.startTime;
                oldestIndex = index;
            }
        });

        if (oldestIndex !== -1) {
            const stolen = this.activeVoices.get(oldestIndex);
            if (stolen) {
                stolen.voice.noteOff(this.audioContext.currentTime);
                this.activeVoices.delete(oldestIndex);
                playbackHealthMonitor.recordVoiceSteal('singingVoice');
            }
            this.loadedBanks.set(oldestIndex, bankId);
            return { voice: this.voices[oldestIndex], index: oldestIndex, isNewBank: true };
        }

        // Fallback
        this.loadedBanks.set(0, bankId);
        return { voice: this.voices[0], index: 0, isNewBank: true };
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
        this.activeVoices.set(index, {
            voice: this.voices[index],
            note,
            startTime
        });
    }

    /**
     * Release a specific voice index.
     */
    releaseVoice(index: number) {
        this.activeVoices.delete(index);
    }

    /**
     * Get a specific voice by index (for direct access like params update)
     */
    getVoice(index: number): SingingVoice | undefined {
        return this.voices[index];
    }

    /**
     * Get all voices (active or not)
     */
    getAllVoices(): SingingVoice[] {
        return this.voices;
    }

    stopAll() {
        this.activeVoices.clear();
        // Reset params on all voices?
    }
}
