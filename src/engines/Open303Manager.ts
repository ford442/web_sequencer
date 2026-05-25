import type { Bass2Params } from '../types';
import { Open303Oscillator } from './Open303Oscillator';
import { engineTelemetry } from '../utils/engineTelemetry';
import type { Open303Config } from './Open303Params';

/**
 * Manages dual Open303 (TB-303) instances for independent bass tracks
 * - bass1: Used by partB (SYNTH B // BASS) 
 * - bass2: Independent second bass track
 */
export class Open303Manager {
    private bass1: Open303Oscillator | null = null;
    private bass2: Open303Oscillator | null = null;
    private audioContext: AudioContext | null = null;
    private workletUrl: string | undefined;
    
    // Mixer nodes for independent routing
    private bass1Gain: GainNode | null = null;
    private bass2Gain: GainNode | null = null;
    private bass1Panner: StereoPannerNode | null = null;
    private bass2Panner: StereoPannerNode | null = null;
    
    // State tracking
    public isReady: boolean = false;
    private bass1Ready: boolean = false;
    private bass2Ready: boolean = false;

    /**
     * Initialize both Open303 instances
     */
    async init(
        audioContext: AudioContext, 
        workletUrl?: string, 
        config?: Open303Config
    ): Promise<boolean> {
        this.audioContext = audioContext;
        this.workletUrl = workletUrl;

        try {
            // Create mixer nodes for independent routing
            this.bass1Gain = audioContext.createGain();
            this.bass1Gain.gain.value = 1.0;
            
            this.bass2Gain = audioContext.createGain();
            this.bass2Gain.gain.value = 1.0;

            // Create panners for stereo positioning
            if (audioContext.createStereoPanner) {
                this.bass1Panner = audioContext.createStereoPanner();
                this.bass1Panner.pan.value = -0.2; // Slightly left
                this.bass1Gain.connect(this.bass1Panner);

                this.bass2Panner = audioContext.createStereoPanner();
                this.bass2Panner.pan.value = 0.2; // Slightly right
                this.bass2Gain.connect(this.bass2Panner);
            }

            // Initialize bass1 and bass2 in parallel — each does a WASM fetch and
            // worklet addModule. The browser dedupes the addModule call for the same URL,
            // so running these concurrently halves the open303 init wall-clock.
            this.bass1 = new Open303Oscillator();
            this.bass2 = new Open303Oscillator();
            const initConfig = {
                ...config,
                preferWorklet: true,
                preferThreaded: false,
                forceSingleThreaded: true
            };
            const results = await Promise.allSettled([
                this.bass1.init(audioContext, workletUrl, initConfig),
                this.bass2.init(audioContext, workletUrl, initConfig),
            ]);
            this.bass1Ready = results[0].status === 'fulfilled' ? results[0].value : false;
            this.bass2Ready = results[1].status === 'fulfilled' ? results[1].value : false;

            if (this.bass1Ready) this.bass1.connect(this.bass1Gain);
            if (this.bass2Ready) this.bass2.connect(this.bass2Gain);

            this.isReady = this.bass1Ready || this.bass2Ready;
            
            if (this.isReady) {
                console.log('[Open303Manager] Dual 303 instances initialized:', {
                    bass1: this.bass1Ready,
                    bass2: this.bass2Ready
                });
                try {
                    const b1 = this.bass1?.isFallback ? 'js' : (this.bass1Ready ? 'wasm' : 'none');
                    const b2 = this.bass2?.isFallback ? 'js' : (this.bass2Ready ? 'wasm' : 'none');
                    let backend = 'none';
                    if (b1 === b2) backend = b1;
                    else backend = 'mixed';
                    engineTelemetry.registerResolution('jc303', backend, `bass1:${b1},bass2:${b2}`);
                } catch (_) {}
            }

            return this.isReady;

        } catch (e) {
            console.error('[Open303Manager] Initialization failed:', e);
            this.isReady = false;
            return false;
        }
    }

    /**
     * Connect both bass instances to a destination
     */
    connect(dest: AudioNode): void {
        if (this.bass1Panner) {
            this.bass1Panner.connect(dest);
        } else if (this.bass1Gain) {
            this.bass1Gain.connect(dest);
        }

        if (this.bass2Panner) {
            this.bass2Panner.connect(dest);
        } else if (this.bass2Gain) {
            this.bass2Gain.connect(dest);
        }
    }

    /**
     * Disconnect from all destinations
     */
    disconnect(): void {
        if (this.bass1Panner) {
            this.bass1Panner.disconnect();
        }
        if (this.bass2Panner) {
            this.bass2Panner.disconnect();
        }
    }

    /**
     * Apply parameters to bass1 (used by partB)
     */
    applyBass1Params(params: { filterCutoff: number; filterResonance: number; filterMode?: number; decay: number; volume: number; pan?: number }, waveform: 'saw' | 'sqr'): void {
        if (!this.bass1Ready || !this.bass1) return;

        this.bass1.setWaveform(waveform === 'sqr' ? 1.0 : 0.0);
        this.bass1.setCutoff(Math.max(0, Math.min(1, params.filterCutoff / 8000)));
        this.bass1.setResonance(Math.max(0, Math.min(1, params.filterResonance / 20)));
        this.bass1.setFilterMode(Math.max(0, Math.min(1, params.filterMode ?? 0)));
        this.bass1.setDecay(Math.max(0, Math.min(1, params.decay)));
        this.bass1.setVolume(params.volume);

        if (params.pan !== undefined) {
            this.setBass1Pan(params.pan);
        }
    }

    /**
     * Apply parameters to bass2 (independent bass track)
     */
    applyBass2Params(params: Bass2Params): void {
        if (!this.bass2Ready || !this.bass2) return;

        this.bass2.setWaveform(params.waveform === '303-sqr' ? 1.0 : 0.0);
        this.bass2.setCutoff(Math.max(0, Math.min(1, params.cutoff / 8000)));
        this.bass2.setResonance(Math.max(0, Math.min(1, params.resonance / 20)));
        this.bass2.setFilterMode(Math.max(0, Math.min(1, params.filterMode)));
        this.bass2.setDecay(Math.max(0, Math.min(1, params.decay)));
        this.bass2.setAccent(params.accent);
        this.bass2.setEnvMod(params.envMod);
        this.bass2.setVolume(params.volume);

        if (params.pan !== undefined) {
            this.setBass2Pan(params.pan);
        }
    }

    /**
     * Trigger note on bass1
     */
    noteOnBass1(midiNote: number, velocity: number = 100): void {
        if (this.bass1Ready && this.bass1) {
            this.bass1.noteOn(midiNote, velocity);
        }
    }

    /**
     * Release note on bass1
     */
    noteOffBass1(midiNote: number): void {
        if (this.bass1Ready && this.bass1) {
            this.bass1.noteOff(midiNote);
        }
    }

    /**
     * Trigger note on bass2
     */
    noteOnBass2(midiNote: number, velocity: number = 100): void {
        if (this.bass2Ready && this.bass2) {
            this.bass2.noteOn(midiNote, velocity);
        }
    }

    /**
     * Release note on bass2
     */
    noteOffBass2(midiNote: number): void {
        if (this.bass2Ready && this.bass2) {
            this.bass2.noteOff(midiNote);
        }
    }

    /**
     * Set bass1 volume (mixer)
     */
    setBass1Volume(volume: number): void {
        if (this.bass1Gain) {
            this.bass1Gain.gain.setValueAtTime(volume, this.audioContext?.currentTime || 0);
        }
    }

    /**
     * Set bass2 volume (mixer)
     */
    setBass2Volume(volume: number): void {
        if (this.bass2Gain) {
            this.bass2Gain.gain.setValueAtTime(volume, this.audioContext?.currentTime || 0);
        }
    }

    /**
     * Set bass1 pan (mixer)
     */
    setBass1Pan(pan: number): void {
        if (this.bass1Panner) {
            this.bass1Panner.pan.setValueAtTime(pan, this.audioContext?.currentTime || 0);
        }
    }

    /**
     * Set bass2 pan (mixer)
     */
    setBass2Pan(pan: number): void {
        if (this.bass2Panner) {
            this.bass2Panner.pan.setValueAtTime(pan, this.audioContext?.currentTime || 0);
        }
    }

    /**
     * Mute/unmute bass1
     */
    setBass1Mute(muted: boolean): void {
        if (this.bass1Gain) {
            this.bass1Gain.gain.setValueAtTime(muted ? 0 : 1, this.audioContext?.currentTime || 0);
        }
    }

    /**
     * Mute/unmute bass2
     */
    setBass2Mute(muted: boolean): void {
        if (this.bass2Gain) {
            this.bass2Gain.gain.setValueAtTime(muted ? 0 : 1, this.audioContext?.currentTime || 0);
        }
    }

    /**
     * Solo bass1 (mute bass2)
     */
    soloBass1(): void {
        this.setBass1Mute(false);
        this.setBass2Mute(true);
    }

    /**
     * Solo bass2 (mute bass1)
     */
    soloBass2(): void {
        this.setBass1Mute(true);
        this.setBass2Mute(false);
    }

    /**
     * Clear solo (unmute both)
     */
    clearSolo(): void {
        this.setBass1Mute(false);
        this.setBass2Mute(false);
    }

    // ---- Open303Oscillator-compatible API (delegates to bass1) ----
    // synthPlayback.ts calls these via the Open303Oscillator interface. Routing
    // them to bass1 keeps the live-play and sequencer paths consistent.
    setWaveform(v: number) { this.bass1?.setWaveform(v); }
    setCutoff(v: number) { this.bass1?.setCutoff(v); }
    setResonance(v: number) { this.bass1?.setResonance(v); }
    setFilterMode(v: number) { this.bass1?.setFilterMode(v); }
    setDecay(v: number) { this.bass1?.setDecay(v); }
    setEnvMod(v: number) { this.bass1?.setEnvMod(v); }
    setAccent(v: number) { this.bass1?.setAccent(v); }
    setVolume(v: number) { this.bass1?.setVolume(v); }
    noteOn(note: number, velocity: number = 100) { this.noteOnBass1(note, velocity); }
    noteOff(note: number) { this.noteOffBass1(note); }

    /**
     * Get bass1 ready state
     */
    isBass1Ready(): boolean {
        return this.bass1Ready;
    }

    /**
     * Get bass2 ready state
     */
    isBass2Ready(): boolean {
        return this.bass2Ready;
    }

    /**
     * Cleanup both instances
     */
    cleanup(): void {
        this.bass1?.cleanup();
        this.bass2?.cleanup();
        
        if (this.bass1Gain) {
            this.bass1Gain.disconnect();
            this.bass1Gain = null;
        }
        if (this.bass2Gain) {
            this.bass2Gain.disconnect();
            this.bass2Gain = null;
        }
        if (this.bass1Panner) {
            this.bass1Panner.disconnect();
            this.bass1Panner = null;
        }
        if (this.bass2Panner) {
            this.bass2Panner.disconnect();
            this.bass2Panner = null;
        }
        
        this.bass1 = null;
        this.bass2 = null;
        this.isReady = false;
        this.bass1Ready = false;
        this.bass2Ready = false;
    }

    /**
     * Switch the DSP engine for the bass1 (SYNTH B / partB) voice.
     *
     * 'open303' — custom synthesizer (default)
     * 'jc303'   — authentic rosic::Open303
     */
    setBass1Engine(engine: 'open303' | 'jc303'): void {
        this.bass1?.setEngine303(engine);
    }

    /**
     * Switch the DSP engine for the bass2 (BASS 2) voice.
     *
     * 'open303' — custom synthesizer (default)
     * 'jc303'   — authentic rosic::Open303
     */
    setBass2Engine(engine: 'open303' | 'jc303'): void {
        this.bass2?.setEngine303(engine);
    }
}
