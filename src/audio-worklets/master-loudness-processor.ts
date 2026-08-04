// src/audio-worklets/master-loudness-processor.ts
// Master-bus true-peak limiter + BS.1770-5 loudness meter.
//
// Sits post-compressor / pre-destination. The limiter runs first, the meter
// measures the limiter's *output*, so the numbers on screen are the numbers
// that leave the master bus (and, via the shared DSP, the numbers in the file).
//
// Only scalar stats cross the MessagePort, at most `reportHz` times per second.
// No audio buffers are ever posted to the main thread.

import { WorkletPerfReporter } from './workletPerfReporter';
import { LoudnessMeter } from '../audio/loudness/loudnessMeter';
import { TruePeakLimiter } from '../audio/loudness/limiter';
import { MASTER_LOUDNESS_PROCESSOR_NAME } from '../audio/loudness/types';
import type {
    LimiterSettings,
    LoudnessStats,
    MasterLoudnessCommand,
} from '../audio/loudness/types';

declare class AudioWorkletProcessor {
    readonly port: MessagePort;
    constructor(options?: unknown);
    process(
        inputs: Float32Array[][],
        outputs: Float32Array[][],
        parameters: Record<string, Float32Array>,
    ): boolean;
}

declare function registerProcessor(
    name: string,
    processorCtor: new (options?: unknown) => AudioWorkletProcessor,
): void;
declare const sampleRate: number;

const DEFAULT_REPORT_HZ = 24;
const MAX_REPORT_HZ = 30;
const CHANNEL_COUNT = 2;

interface MasterLoudnessOptions {
    processorOptions?: {
        limiter?: Partial<LimiterSettings>;
        reportHz?: number;
    };
}

class MasterLoudnessProcessor extends AudioWorkletProcessor {
    private readonly meter: LoudnessMeter;
    private readonly limiter: TruePeakLimiter;
    /** Reusable views handed to the DSP — never reallocated in process(). */
    private readonly inputViews: Float32Array[] = [];
    private readonly outputViews: Float32Array[] = [];
    /** Zero-filled stand-in for a missing input channel; sized to the quantum once. */
    private silence: Float32Array;

    /** Audio-thread CPU telemetry, same channel as the other worklets. */
    private readonly perf: WorkletPerfReporter;

    private framesSinceReport = 0;
    private reportInterval: number;
    private alive = true;

    constructor(options?: unknown) {
        super();
        const processorOptions = (options as MasterLoudnessOptions | undefined)?.processorOptions ?? {};
        this.meter = new LoudnessMeter({ sampleRate, channelCount: CHANNEL_COUNT });
        this.limiter = new TruePeakLimiter(sampleRate, CHANNEL_COUNT, processorOptions.limiter);
        this.silence = new Float32Array(128);
        this.perf = new WorkletPerfReporter(this.port, 'masterLoudness');
        this.reportInterval = this.framesPerReport(processorOptions.reportHz ?? DEFAULT_REPORT_HZ);

        this.port.onmessage = (event: MessageEvent<MasterLoudnessCommand>) => {
            this.handleCommand(event.data);
        };
    }

    private framesPerReport(hz: number): number {
        const clamped = Math.min(Math.max(hz, 1), MAX_REPORT_HZ);
        return Math.max(1, Math.round(sampleRate / clamped));
    }

    private handleCommand(command: MasterLoudnessCommand | undefined): void {
        if (!command) return;
        switch (command.type) {
            case 'set-limiter':
                this.limiter.setSettings(command.data);
                break;
            case 'reset-loudness':
                // Momentary/short-term keep running; only the integrated
                // measurement and held peaks are user-resettable.
                this.meter.resetIntegrated();
                this.meter.resetPeaks();
                break;
            case 'set-report-hz':
                this.reportInterval = this.framesPerReport(command.data);
                break;
            default:
                break;
        }
    }

    private buildStats(): LoudnessStats {
        const { gainReductionDb, clipped } = this.limiter.takeStats();
        return {
            momentary: this.meter.momentary,
            shortTerm: this.meter.shortTerm,
            integrated: this.meter.integrated,
            truePeak: this.meter.truePeakDb,
            samplePeak: this.meter.samplePeakDb,
            gainReduction: gainReductionDb,
            clipped,
        };
    }

    process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
        const output = outputs[0];
        if (!output || output.length === 0) return this.alive;

        const frames = output[0].length;
        const endProcess = this.perf.beginProcess(frames);
        try {
            this.render(inputs, output, frames);
        } finally {
            endProcess();
        }
        return this.alive;
    }

    private render(inputs: Float32Array[][], output: Float32Array[], frames: number): void {
        const input = inputs[0];
        if (this.silence.length !== frames) {
            // The render quantum is fixed at 128 in practice; this runs once.
            this.silence = new Float32Array(frames);
        }
        for (let ch = 0; ch < CHANNEL_COUNT; ch += 1) {
            const source = input?.[ch] ?? input?.[0];
            this.inputViews[ch] = source && source.length >= frames ? source : this.silence;
            this.outputViews[ch] = output[ch] ?? output[0];
        }

        this.limiter.process(this.inputViews, this.outputViews, frames);
        this.meter.process(this.outputViews, frames);

        // Mono destinations get the limited left channel rather than silence.
        for (let ch = CHANNEL_COUNT; ch < output.length; ch += 1) {
            const extra = output[ch];
            for (let i = 0; i < frames; i += 1) extra[i] = this.outputViews[0][i];
        }

        this.framesSinceReport += frames;
        if (this.framesSinceReport >= this.reportInterval) {
            this.framesSinceReport = 0;
            this.port.postMessage({
                type: 'loudness-stats',
                data: this.buildStats(),
                latencySeconds: this.limiter.latencySeconds,
            });
        }
    }
}

registerProcessor(MASTER_LOUDNESS_PROCESSOR_NAME, MasterLoudnessProcessor);
