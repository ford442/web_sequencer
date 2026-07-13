// AudioWorklet-based sequencer clock.
//
// Runs entirely on the audio rendering thread — immune to main-thread GC pauses,
// `setTimeout` jitter, and background-tab throttling (which collapses rAF to 1 Hz).
//
// Step messages include the precise AudioContext `audioTime` at which the step falls,
// so the main thread can schedule notes into the future without re-checking currentTime.
//
// Swing model (16th-note shuffle):
//   Even steps (on-beat)  fire after  T * (1 + swing/2)  samples
//   Odd steps  (off-beat) fire after  T * (1 - swing/2)  samples
//   swing = 0 → straight, swing = 1 → maximum shuffle (~66/34 split, classic triplet feel)
//   The pair duration (even + odd) always equals 2T regardless of swing.

declare class AudioWorkletProcessor {
    readonly port: MessagePort;
    process(
        inputs: Float32Array[][],
        outputs: Float32Array[][],
        parameters: Record<string, Float32Array>,
    ): boolean;
}
declare function registerProcessor(name: string, ctor: new (options?: unknown) => AudioWorkletProcessor): void;
declare const sampleRate: number;
declare const currentTime: number;   // AudioWorkletGlobalScope: time of current block

interface ClockMessage {
    type: 'start' | 'stop' | 'setTempo' | 'setSwing' | 'setSteps';
    tempo?: number;
    swing?: number;
    steps?: number;
}

class ClockProcessor extends AudioWorkletProcessor {
    private running = false;
    private tempo = 120;
    private swing = 0;           // 0–1
    private numSteps = 32;

    // Accumulated sample count since playback start
    private sampleCursor = 0;
    // Sample index at which the *next* step fires (relative to playback start)
    private nextStepAtSample = 0;
    // The step that will fire next (0-indexed)
    private nextStep = 0;

    constructor() {
        super();
        this.port.onmessage = (e: MessageEvent<ClockMessage>) => {
            const { type, tempo, swing, steps } = e.data;
            switch (type) {
                case 'start':
                    this.sampleCursor = 0;
                    this.nextStepAtSample = 0;
                    this.nextStep = 0;
                    this.running = true;
                    break;
                case 'stop':
                    this.running = false;
                    break;
                case 'setTempo':
                    if (tempo != null && Number.isFinite(tempo) && tempo > 0) {
                        this.tempo = tempo;
                    }
                    break;
                case 'setSwing':
                    if (swing != null && Number.isFinite(swing)) {
                        this.swing = Math.max(0, Math.min(1, swing));
                    }
                    break;
                case 'setSteps':
                    if (steps != null && steps > 0) {
                        this.numSteps = steps;
                    }
                    break;
            }
        };
    }

    // Duration in samples for a single 16th-note step at the current tempo,
    // applying swing for even/odd parity.
    // parity: 0 = on-beat (even step index), 1 = off-beat (odd step index).
    private stepDurationSamples(parity: 0 | 1): number {
        const baseSamples = (sampleRate * 60) / (this.tempo * 4);
        // swing shifts time from odd steps to even steps.
        // parity 0 (even/on-beat): gets extra time
        // parity 1 (odd/off-beat): loses the same time
        const shift = this.swing * baseSamples * 0.5;
        return parity === 0 ? baseSamples + shift : baseSamples - shift;
    }

    process(_inputs: Float32Array[][], outputs: Float32Array[][], _params: Record<string, Float32Array>): boolean {
        const output = outputs[0]?.[0];
        const blockSize = output?.length ?? 128;
        if (output) {
            output.fill(0);
        }

        if (!this.running) return true;

        for (let i = 0; i < blockSize; i++) {
            if (this.sampleCursor >= this.nextStepAtSample) {
                // Exact AudioContext time for this sample (currentTime is the time of
                // the first sample in the current block).
                const audioTime = currentTime + i / sampleRate;

                this.port.postMessage({
                    type: 'step',
                    step: this.nextStep,
                    audioTime,
                });

                // Advance to the next step.
                const parity = (this.nextStep % 2) as 0 | 1;
                this.nextStepAtSample += this.stepDurationSamples(parity);
                this.nextStep = (this.nextStep + 1) % this.numSteps;
            }
            this.sampleCursor++;
        }

        return true; // keep processor alive
    }
}

registerProcessor('clock-processor', ClockProcessor);
