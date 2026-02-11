import type { Open303Params } from './Open303Params';
import { DEFAULT_303_PARAMS } from './Open303Params';

export class Open303Oscillator {
    private workletNode: AudioWorkletNode | null = null;
    private gainNode: GainNode | null = null;
    private outputNode: GainNode | null = null;

    private params: Open303Params = { ...DEFAULT_303_PARAMS };
    public isReady: boolean = false;

    async init(audioContext: AudioContext, workletUrl?: string): Promise<boolean> {

        
        // Create nodes
        this.outputNode = audioContext.createGain();
        this.gainNode = audioContext.createGain();
        this.gainNode.gain.value = 1.0;
        this.gainNode.connect(this.outputNode);

        // Ensure AudioWorklet is supported and URL is provided
        if (audioContext.audioWorklet && workletUrl) {
            try {
                // 1. Fetch the WASM binary manually
                const wasmResponse = await fetch('./jc303.wasm'); // Check this path!
                if (!wasmResponse.ok) {
                    console.warn(`Failed to fetch jc303.wasm: ${wasmResponse.status}`);
                    return false;
                }
                const wasmBytes = await wasmResponse.arrayBuffer();

                // 2. Add the Worklet Module
                await audioContext.audioWorklet.addModule(workletUrl);

                // 3. Create the Node
                this.workletNode = new AudioWorkletNode(audioContext, 'open303-processor', {
                    outputChannelCount: [2] // Request Stereo
                });

                // 4. Send WASM to the Worklet
                // JC-303 is built with OpenMP and requires shared memory
                this.workletNode.port.postMessage({
                    type: 'init-wasm',
                    data: {
                        wasmBytes,
                        sampleRate: audioContext.sampleRate,
                        isThreaded: true  // Required for OpenMP-enabled JC-303 build
                    }
                });

                // 5. Connect and Listen
                this.workletNode.connect(this.gainNode);

                // Wait for worklet to confirm initialization
                const initSuccess = await new Promise<boolean>((resolve) => {
                    this.workletNode!.port.onmessage = (e) => {
                        if (e.data.type === 'ready') {
                            console.log("[Open303] Engine Fully Operational");
                            resolve(true);
                        } else if (e.data.type === 'error') {
                            console.error("[Open303] Worklet Error:", e.data.error);
                            resolve(false);
                        }
                    };
                    
                    // Timeout after 5 seconds
                    setTimeout(() => {
                        console.error("[Open303] Initialization timeout");
                        resolve(false);
                    }, 5000);
                });

                if (!initSuccess) {
                    this.cleanup();
                    return false;
                }

                this.isReady = true;
                this.applyAllParameters();
                return true;

            } catch (e) {
                console.error("Open303 Init Failure:", e);
                return false;
            }
        }
        return false;
    }

    noteOn(midiNote: number, velocity: number = 100): void {
        if (!this.isReady || !this.workletNode) return;
        this.workletNode.port.postMessage({ type: 'noteOn', data: { note: midiNote, velocity } });
    }

    noteOff(midiNote: number): void {
        if (!this.isReady || !this.workletNode) return;
        this.workletNode.port.postMessage({ type: 'noteOff', data: { note: midiNote } });
    }

    setParam(func: string, value: number): void {
        if (!this.isReady || !this.workletNode) return;
        this.workletNode.port.postMessage({ type: 'param', data: { func: `jc303_${func}`, value } });
    }

    // Explicit setters used by the application
    setWaveform(v: number) { this.params.waveform = v; this.setParam('setWaveform', v); }
    setCutoff(v: number) { this.params.cutoff = v; this.setParam('setCutoff', v); }
    setResonance(v: number) { this.params.resonance = v; this.setParam('setResonance', v); }
    setDecay(v: number) { this.params.decay = v; this.setParam('setDecay', v); }
    setEnvMod(v: number) { this.params.envMod = v; this.setParam('setEnvMod', v); }
    setAccent(v: number) { this.params.accent = v; this.setParam('setAccent', v); }
    setVolume(v: number) { this.params.volume = v; this.setParam('setVolume', v); }

    // Helper to sync state
    private applyAllParameters() {
        this.setWaveform(this.params.waveform);
        this.setCutoff(this.params.cutoff);
        this.setResonance(this.params.resonance);
        this.setDecay(this.params.decay);
        this.setEnvMod(this.params.envMod);
        this.setAccent(this.params.accent);
        this.setVolume(this.params.volume);
    }

    connect(dest: AudioNode) {
        if (this.outputNode) this.outputNode.connect(dest);
    }

    disconnect() {
        if (this.outputNode) this.outputNode.disconnect();
    }

    private cleanup() {
        if (this.workletNode) {
            this.workletNode.disconnect();
            this.workletNode.port.close();
            this.workletNode = null;
        }
        if (this.gainNode) {
            this.gainNode.disconnect();
            this.gainNode = null;
        }
        if (this.outputNode) {
            this.outputNode.disconnect();
            this.outputNode = null;
        }
        this.isReady = false;
    }
}
