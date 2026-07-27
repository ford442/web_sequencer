/**
 * MultisampleGenerator - Offline pitch-shifted sample generator
 * 
 * Pre-renders samples at multiple pitch levels using high-quality
 * RubberBand time-stretching in an OfflineAudioContext.
 * 
 * This allows zero-CPU playback of pitch-accurate samples in the sequencer.
 *
 * Phase-3 (#976): also generates high-fidelity 303 multisamples via
 * WebGpu303Engine (GPU diode-ladder with highfid-cpu fallback).
 */

import { SingingVoice } from './SingingVoice';
import {
  float32ToAudioBuffer,
  renderGpuHighFid303,
  type WebGpu303RenderOptions,
} from './WebGpu303Engine';
import type { Offline303Params } from '@/audio/offline/OfflineOpen303Engine';
import { DEFAULT_OFFLINE_303_PARAMS } from '@/audio/offline/OfflineOpen303Engine';

export interface MultisampleBank {
    /** Original sample buffer */
    baseBuffer: AudioBuffer;
    /** Map of MIDI note number to pre-rendered buffer */
    pitchBank: Map<number, AudioBuffer>;
    /** Whether background processing is active */
    isProcessing: boolean;
    /** Processing progress (0.0 - 1.0) */
    processingProgress: number;
    /** Root MIDI note for the base sample (default: 60 = C4) */
    rootNote: number;
    /** Error message if processing failed */
    error?: string;
}

export interface MultisampleOptions {
    /** Base MIDI note for the sample (default: 60 = C4) */
    rootNote?: number;
    /** Semitone range to generate [min, max] (default: [-12, 12]) */
    range?: [number, number];
    /** Preserve formants to avoid chipmunk effect (default: true) */
    preserveFormants?: boolean;
    /** RubberBand quality mode (default: 'Standard') */
    quality?: 'Fast' | 'Standard' | 'Elastic';
    /** Specific pitches to generate (overrides range if provided) */
    onlyPitches?: number[];
}

export interface Multisample303Options {
  /** Sustain length in seconds per note (default: 1.0). */
  durationSec?: number;
  /** MIDI notes to render (default: C1..C3 chromatic-ish 303 range). */
  midiNotes?: number[];
  /** Classic 303 knobs (normalized 0–1 where applicable). */
  params?: Partial<Offline303Params>;
  /** Oversample / sample-rate / forceCpuFallback forwarded to WebGpu303Engine. */
  render?: WebGpu303RenderOptions;
  /** Velocity for all notes (default 90; use >100 for accent). */
  velocity?: number;
}

export type ProgressCallback = (progress: number) => void;

/**
 * Resample audio using simple playback rate (fallback method)
 * Changes both pitch and duration
 */
async function resampleWithPlaybackRate(
    sourceBuffer: AudioBuffer,
    semitones: number
): Promise<AudioBuffer> {
    const pitchRatio = Math.pow(2, semitones / 12);
    const newLength = Math.floor(sourceBuffer.length / pitchRatio);
    
    const offlineCtx = new OfflineAudioContext(
        sourceBuffer.numberOfChannels,
        newLength,
        sourceBuffer.sampleRate
    );
    
    const source = offlineCtx.createBufferSource();
    source.buffer = sourceBuffer;
    source.playbackRate.value = pitchRatio;
    source.connect(offlineCtx.destination);
    source.start();
    
    return await offlineCtx.startRendering();
}

export class MultisampleGenerator {
    private rubberbandWasm: ArrayBuffer | null = null;
    private isWasmLoaded: boolean = false;
    private audioContext: BaseAudioContext;

    constructor(audioContext: BaseAudioContext) {
        this.audioContext = audioContext;
        void this.loadWasm();
    }

    /**
     * Pre-fetch RubberBand WASM for faster processing
     */
    private async loadWasm(): Promise<void> {
        try {
            const response = await fetch(import.meta.env.BASE_URL + 'rubberband.wasm');
            if (response.ok) {
                this.rubberbandWasm = await response.arrayBuffer();
                this.isWasmLoaded = true;
                console.log('MultisampleGenerator: WASM pre-loaded');
            }
        } catch (e) {
            console.warn('MultisampleGenerator: Failed to pre-load WASM, will retry per-bank', e);
        }
    }

    /**
     * Generate pitch-shifted versions of a sample
     * 
     * @param sourceBuffer Original audio buffer
     * @param options Generation options
     * @param onProgress Progress callback (0.0 - 1.0)
     * @returns Map of MIDI note to AudioBuffer
     */
    async generateMultisamples(
        sourceBuffer: AudioBuffer,
        options: MultisampleOptions = {},
        onProgress: ProgressCallback = () => {}
    ): Promise<Map<number, AudioBuffer>> {
        const {
            rootNote = 60,
            range = [-12, 12],
            preserveFormants = true,
            quality = 'Standard',
            onlyPitches
        } = options;

        const pitchBank = new Map<number, AudioBuffer>();
        
        // Always store the original at root note
        pitchBank.set(rootNote, sourceBuffer);

        // Determine which pitches to generate
        const pitchesToGenerate: number[] = onlyPitches || 
            Array.from({ length: range[1] - range[0] + 1 }, (_, i) => range[0] + i)
                .filter(p => p !== 0); // Exclude root (already stored)

        const totalSteps = pitchesToGenerate.length;
        
        if (totalSteps === 0) {
            onProgress(1.0);
            return pitchBank;
        }

        // Process each pitch
        for (let i = 0; i < pitchesToGenerate.length; i++) {
            const semitones = pitchesToGenerate[i];
            const targetMidi = rootNote + semitones;
            
            try {
                // Use RubberBand if available, otherwise fallback to simple repitching
                let processedBuffer: AudioBuffer;
                
                if (this.isWasmLoaded) {
                    processedBuffer = await this.processWithRubberBand(
                        sourceBuffer,
                        semitones,
                        preserveFormants,
                        quality
                    );
                } else {
                    // Fallback: simple resampling (changes duration)
                    processedBuffer = await resampleWithPlaybackRate(sourceBuffer, semitones);
                }
                
                pitchBank.set(targetMidi, processedBuffer);
            } catch (err) {
                console.warn(`Failed to generate pitch ${targetMidi}:`, err);
                // Fallback to simple repitching on error
                try {
                    const fallbackBuffer = await resampleWithPlaybackRate(sourceBuffer, semitones);
                    pitchBank.set(targetMidi, fallbackBuffer);
                } catch (fallbackErr) {
                    console.error(`Fallback also failed for pitch ${targetMidi}:`, fallbackErr);
                }
            }
            
            onProgress((i + 1) / totalSteps);
        }

        return pitchBank;
    }

    /**
     * Process audio with RubberBand for high-quality pitch shifting
     * Preserves duration (time-ratio = 1.0)
     */
    private async processWithRubberBand(
        sourceBuffer: AudioBuffer,
        semitones: number,
        preserveFormants: boolean,
        quality: 'Fast' | 'Standard' | 'Elastic'
    ): Promise<AudioBuffer> {
        // Calculate output length (preserve duration)
        const outputLength = sourceBuffer.length;
        
        const offlineCtx = new OfflineAudioContext(
            sourceBuffer.numberOfChannels,
            outputLength,
            sourceBuffer.sampleRate
        );

        // Create quality config
        const qualityConfig: { useHighQuality: boolean; preserveFormants: boolean } = {
            useHighQuality: quality === 'Elastic',
            preserveFormants
        };

        // Create temporary SingingVoice for offline processing
        const voice = new SingingVoice(offlineCtx as unknown as AudioContext, qualityConfig);
        
        // Initialize with pre-loaded WASM if available
        await voice.initWorklet(false, this.rubberbandWasm || undefined);

        // Calculate pitch ratio
        const pitchRatio = Math.pow(2, semitones / 12);
        
        // Configure: pitch shift but preserve time
        voice.setPitch(pitchRatio);
        voice.setTimeRatio(1.0);

        // Connect to offline destination
        voice.connectOutput(offlineCtx.destination);

        // Get audio data and process
        const audioData = sourceBuffer.getChannelData(0);
        voice.loadBuffer(audioData);
        voice.play();

        // Render
        const renderedBuffer = await offlineCtx.startRendering();

        // Cleanup
        voice.disconnectOutput();

        return renderedBuffer;
    }

    /**
     * Generate high-fidelity 303 note buffers (Phase-3 / #976).
     *
     * Uses WebGpu303Engine when available; falls back to highfid-cpu.
     * Returned AudioBuffers are ready for AudioBufferSourceNode playback —
     * never schedule the GPU render on the AudioWorklet thread.
     */
    async generate303HighFidMultisamples(
        options: Multisample303Options = {},
        onProgress: ProgressCallback = () => {},
    ): Promise<Map<number, AudioBuffer>> {
        const durationSec = options.durationSec ?? 1.0;
        const velocity = options.velocity ?? 90;
        const params = { ...DEFAULT_OFFLINE_303_PARAMS, ...options.params };
        const midiNotes =
            options.midiNotes ??
            [24, 26, 28, 29, 31, 33, 35, 36, 38, 40, 41, 43, 45, 47, 48];
        const sampleRate =
            options.render?.sampleRate ?? this.audioContext.sampleRate ?? 44100;
        const pitchBank = new Map<number, AudioBuffer>();
        const total = midiNotes.length;

        for (let i = 0; i < midiNotes.length; i++) {
            const midi = midiNotes[i];
            const meta = await renderGpuHighFid303(
                {
                    steps: [{ note: midi, velocity }],
                    stepDurationSec: durationSec,
                    params,
                },
                { ...options.render, sampleRate },
            );
            const audioBuf = float32ToAudioBuffer(
                this.audioContext,
                meta.buffer,
                sampleRate,
            );
            pitchBank.set(midi, audioBuf);
            onProgress((i + 1) / total);
        }

        return pitchBank;
    }

    /**
     * Check if a specific pitch is available in a bank
     */
    static hasPitch(bank: MultisampleBank, midiNote: number): boolean {
        return bank.pitchBank.has(midiNote);
    }

    /**
     * Get the best available buffer for a MIDI note
     * Returns exact match if available, otherwise returns base buffer
     */
    static getBufferForNote(bank: MultisampleBank, midiNote: number): AudioBuffer | null {
        // Try exact match first
        if (bank.pitchBank.has(midiNote)) {
            return bank.pitchBank.get(midiNote)!;
        }
        
        // Fall back to base buffer
        return bank.baseBuffer;
    }

    /**
     * Calculate pitch ratio needed to play a note from a bank
     */
    static calculatePitchRatio(bank: MultisampleBank, targetMidi: number): number {
        // If we have the exact pitch, no ratio adjustment needed
        if (bank.pitchBank.has(targetMidi)) {
            return 1.0;
        }
        
        // Otherwise calculate from root note
        const rootMidi = bank.rootNote;
        return Math.pow(2, (targetMidi - rootMidi) / 12);
    }
}
