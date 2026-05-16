import { SingingVoice, type SingingVoiceConfig } from './SingingVoice';

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
     * @returns The allocated SingingVoice and its index
     */
    acquireVoice(): { voice: SingingVoice; index: number } {
        // 1. Find a free voice (not in activeVoices)
        const activeIndices = new Set(this.activeVoices.keys());
        for (let i = 0; i < this.maxVoices; i++) {
            if (!activeIndices.has(i)) {
                return { voice: this.voices[i], index: i };
            }
        }

        // 2. Steal oldest voice
        let oldestTime = Infinity;
        let oldestIndex = -1;

        this.activeVoices.forEach((v, index) => {
            if (v.startTime < oldestTime) {
                oldestTime = v.startTime;
                oldestIndex = index;
            }
        });

        if (oldestIndex !== -1) {
            // Force disconnect/reset? Or just return it and let caller override
            // Ideally we might want to fade it out, but for now we hard steal
            return { voice: this.voices[oldestIndex], index: oldestIndex };
        }

        // Fallback (shouldn't happen with correct logic)
        return { voice: this.voices[0], index: 0 };
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
