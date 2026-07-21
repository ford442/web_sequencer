/**
 * PCF (Pattern Controlled Filter) Effect Engine
 *
 * Manages the PCF AudioWorklet node and provides a high-level API
 * for integrating the ReBirth-style pattern-controlled filter into
 * the audio chain. Supports:
 * - Loading PCF settings from imported .rbs files
 * - Real-time parameter control
 * - Transport synchronization
 * - External automation lane driving
 *
 * Usage:
 * ```typescript
 * const pcf = new PcfEffect(audioContext);
 * await pcf.init();
 * pcf.loadSettings(rbsPcfSettings);
 * sourceNode.connect(pcf.input);
 * pcf.output.connect(destinationNode);
 * ```
 */

import type { PcfSettings } from '@/importers/rbs/types';

/** URL to the PCF processor worklet file */
const PCF_PROCESSOR_URL = new URL('../audio-worklets/pcf-processor.ts', import.meta.url).href;

/** Filter type numeric constants matching the processor */
const FILTER_TYPE_MAP: Record<string, number> = {
    'lp': 0,
    'bp': 1,
    'hp': 2,
};

/** PCF parameters exposed for UI/automation */
export interface PcfParams {
    enabled: boolean;
    filterType: 'lp' | 'bp' | 'hp';
    cutoff: number;      // 0-127
    resonance: number;   // 0-127
    envAmount: number;   // 0-127
    decay: number;       // 0-127
}

/**
 * PcfEffect manages a PCF AudioWorklet node in the audio graph.
 * Insert it between a source and destination to apply pattern-controlled filtering.
 */
export class PcfEffect {
    private audioContext: AudioContext;
    private workletNode: AudioWorkletNode | null = null;
    private inputGain: GainNode;
    private outputGain: GainNode;
    private initialized = false;

    // Current state
    private _enabled = false;
    private _filterType: 'lp' | 'bp' | 'hp' = 'lp';
    private _cutoff = 80;
    private _resonance = 40;
    private _envAmount = 60;
    private _decay = 40;
    private _pattern: number[] = Array.from({ length: 16 }, () => 0);

    constructor(audioContext: AudioContext) {
        this.audioContext = audioContext;
        // Create pass-through gain nodes for connection points
        this.inputGain = audioContext.createGain();
        this.outputGain = audioContext.createGain();
        // Default: pass-through (until worklet is loaded)
        this.inputGain.connect(this.outputGain);
    }

    /** The input node to connect audio sources to */
    get input(): AudioNode {
        return this.inputGain;
    }

    /** The output node to connect to downstream destinations */
    get output(): AudioNode {
        return this.outputGain;
    }

    /** Whether the PCF effect is currently enabled */
    get enabled(): boolean {
        return this._enabled;
    }

    /** Whether the worklet has been initialized */
    get isInitialized(): boolean {
        return this.initialized;
    }

    /** Current parameters */
    get params(): PcfParams {
        return {
            enabled: this._enabled,
            filterType: this._filterType,
            cutoff: this._cutoff,
            resonance: this._resonance,
            envAmount: this._envAmount,
            decay: this._decay,
        };
    }

    /** Current pattern */
    get pattern(): number[] {
        return [...this._pattern];
    }

    /**
     * Initialize the PCF AudioWorklet processor.
     * Must be called before the effect will process audio.
     */
    async init(): Promise<void> {
        if (this.initialized) return;

        try {
            await this.audioContext.audioWorklet.addModule(PCF_PROCESSOR_URL);

            this.workletNode = new AudioWorkletNode(this.audioContext, 'pcf-processor', {
                numberOfInputs: 1,
                numberOfOutputs: 1,
                outputChannelCount: [2],
                channelCount: 2,
                channelCountMode: 'explicit',
            });

            // Rewire: input → worklet → output (replacing direct pass-through)
            this.inputGain.disconnect(this.outputGain);
            this.inputGain.connect(this.workletNode);
            this.workletNode.connect(this.outputGain);

            this.initialized = true;

            // Send current state to processor
            this.syncAllParams();

            console.log('[PcfEffect] AudioWorklet initialized');
        } catch (error) {
            console.error('[PcfEffect] Failed to initialize AudioWorklet:', error);
            // Keep pass-through on failure
            throw error;
        }
    }

    /**
     * Load PCF settings from imported .rbs data.
     * Updates all parameters and the modulation pattern.
     */
    loadSettings(settings: PcfSettings): void {
        this._enabled = settings.enabled;
        this._filterType = settings.filterType;
        this._cutoff = settings.cutoff;
        this._resonance = settings.resonance;
        this._envAmount = settings.envAmount;
        this._decay = settings.decay;
        this._pattern = [...settings.pattern];

        this.syncAllParams();
    }

    /**
     * Set individual parameters.
     */
    setParams(params: Partial<PcfParams>): void {
        if (params.enabled !== undefined) this._enabled = params.enabled;
        if (params.filterType !== undefined) this._filterType = params.filterType;
        if (params.cutoff !== undefined) this._cutoff = Math.max(0, Math.min(127, params.cutoff));
        if (params.resonance !== undefined) this._resonance = Math.max(0, Math.min(127, params.resonance));
        if (params.envAmount !== undefined) this._envAmount = Math.max(0, Math.min(127, params.envAmount));
        if (params.decay !== undefined) this._decay = Math.max(0, Math.min(127, params.decay));

        this.syncAllParams();
    }

    /**
     * Set the modulation pattern.
     * @param pattern Array of 0-127 values, typically 16 or 32 steps
     */
    setPattern(pattern: number[]): void {
        this._pattern = pattern.slice(0, 32).map(v => Math.max(0, Math.min(127, v)));
        this.sendMessage('set-pattern', this._pattern);
    }

    /**
     * Update transport state for pattern synchronization.
     */
    setTransport(playing: boolean, bpm: number, stepIndex?: number): void {
        const data: Record<string, unknown> = { playing, bpm };
        if (stepIndex !== undefined) data.stepIndex = stepIndex;
        this.sendMessage('set-transport', data);
    }

    /**
     * Set automation-driven cutoff (overrides pattern modulation).
     * Pass -1 or undefined to return to pattern-driven mode.
     */
    setAutomationCutoff(cutoffHz: number | undefined): void {
        if (cutoffHz === undefined || cutoffHz < 0) {
            this.sendMessage('set-automation', { cutoffHz: -1 });
        } else {
            this.sendMessage('set-automation', { cutoffHz });
        }
    }

    /**
     * Set automation-driven resonance (overrides the base resonance param).
     * @param resonanceMidi 0-127 MIDI-range resonance; pass null/undefined to clear override.
     */
    setAutomationResonance(resonanceMidi: number | null | undefined): void {
        if (resonanceMidi === null || resonanceMidi === undefined) {
            this.sendMessage('set-automation', { resonanceMidi: null });
        } else {
            this.sendMessage('set-automation', { resonanceMidi: Math.max(0, Math.min(127, resonanceMidi)) });
        }
    }

    /**
     * Set automation-driven envelope amount (overrides the base envAmount param).
     * @param envAmountNorm 0-1 normalised envelope amount; pass null/undefined to clear override.
     */
    setAutomationEnvAmount(envAmountNorm: number | null | undefined): void {
        if (envAmountNorm === null || envAmountNorm === undefined) {
            this.sendMessage('set-automation', { envAmountNorm: null });
        } else {
            this.sendMessage('set-automation', { envAmountNorm: Math.max(0, Math.min(1, envAmountNorm)) });
        }
    }

    /**
     * Enable or disable the effect.
     */
    setEnabled(enabled: boolean): void {
        this._enabled = enabled;
        this.sendMessage('set-enabled', enabled);
    }

    /**
     * Disconnect and clean up resources.
     */
    dispose(): void {
        if (this.workletNode) {
            this.workletNode.disconnect();
            this.workletNode = null;
        }
        this.inputGain.disconnect();
        this.outputGain.disconnect();
        this.initialized = false;
    }

    // ─── Private ─────────────────────────────────────────────────────────

    private syncAllParams(): void {
        this.sendMessage('set-enabled', this._enabled);
        this.sendMessage('set-params', {
            filterType: FILTER_TYPE_MAP[this._filterType] ?? 0,
            cutoff: this._cutoff,
            resonance: this._resonance,
            envAmount: this._envAmount,
            decay: this._decay,
        });
        this.sendMessage('set-pattern', this._pattern);
    }

    private sendMessage(type: string, data: unknown): void {
        if (this.workletNode) {
            this.workletNode.port.postMessage({ type, data });
        }
    }
}
