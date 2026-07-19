/**
 * Track Freezer Utility
 * Renders complex synth/drum patterns to simple audio buffers for CPU savings
 */
// @mode: bridge
// @migrate-target: assemblyscript
// @perf-bottleneck: Loop analysis in findLoopPoints scans entire buffer
// @future-plan: Move findLoopPoints and audioBufferToMono to WASM for large buffer processing

import type { PartSequence, SynthParams, KickParams, SnareParams, HatParams } from '../types';
// @ts-ignore
const initTrackFreezer = async () => {
    const m = await import('../wasm/trackFreezer.wasm?init');
    return m.default;
};
import { engineTelemetry } from './engineTelemetry';

// WASM Module Loader
interface WasmExports {
    memory: WebAssembly.Memory;
    findLoopPoints: (bufferPtr: number, length: number, minLoopLength: number) => bigint;
    mixToMono: (leftPtr: number, rightPtr: number, outputPtr: number, length: number) => void;
    __new: (size: number, classId: number) => number;
    __pin: (ptr: number) => number;
    __unpin: (ptr: number) => void;
    __collect: () => void;
}

let wasmInstance: WasmExports | null = null;

// Allow external injection for testing
export const setWasmInstance = (instance: WasmExports) => {
    wasmInstance = instance;
};

const loadWasm = async () => {
    if (wasmInstance) return;
    try {
        const initFn = await initTrackFreezer();
        const instance = await initFn({
            env: {
                abort: () => console.error("WASM Abort")
            }
        });
        wasmInstance = instance.exports as unknown as WasmExports;
        try { engineTelemetry.registerResolution('trackFreezer','wasm','loaded'); } catch (e) { /* noop */ }
    } catch (e) {
        try { engineTelemetry.registerResolution('trackFreezer','js','failed to load wasm: ' + String(e)); } catch (err) { /* noop */ }
        console.warn("Failed to load trackFreezer.wasm, using JS fallback", e);
    }
};

// Initialize WASM in background
if (typeof window !== 'undefined') {
    loadWasm();
}

export interface FreezeOptions {
    bpm: number;
    sampleRate?: number;
}

/**
 * Freezes a synth track using Python's offline rendering
 */
export const freezeSynthTrack = async (
    pyodide: any,
    sequence: PartSequence,
    params: SynthParams,
    options: FreezeOptions
): Promise<AudioBuffer> => {
    if (!pyodide) throw new Error('Pyodide not initialized');

    const sampleRate = options.sampleRate || 44100;

    // Prepare params for Python
    const pythonParams = {
        bpm: options.bpm,
        waveform: params.waveform,
        filterCutoff: params.filterCutoff,
        filterResonance: params.filterResonance,
        attack: params.attack,
        decay: params.decay,
        sustain: params.sustain,
        release: params.release,
        volume: params.volume,
    };

    // Call Python freezer
    const freezeFunc = pyodide.globals.get('freeze_synth_track');
    const pyResult = freezeFunc(JSON.stringify(sequence.steps), JSON.stringify(pythonParams));
    const audioData = pyResult.toJs({ array_buffer_type: 'float32' });
    pyResult.destroy();

    // Create AudioBuffer from result
    const audioContext = new OfflineAudioContext(1, audioData.length, sampleRate);
    const buffer = audioContext.createBuffer(1, audioData.length, sampleRate);
    buffer.getChannelData(0).set(audioData);

    return buffer;
};

/**
 * Freezes a drum track using Python's offline rendering
 */
export const freezeDrumTrack = async (
    pyodide: any,
    sequence: PartSequence,
    params: KickParams | SnareParams | HatParams,
    drumType: 'kick' | 'snare' | 'closedHat' | 'openHat',
    options: FreezeOptions
): Promise<AudioBuffer> => {
    if (!pyodide) throw new Error('Pyodide not initialized');

    const sampleRate = options.sampleRate || 44100;

    // Map drum type to simpler Python type
    const pyDrumType = drumType === 'kick' ? 'kick' :
        drumType === 'snare' ? 'snare' : 'hat';

    // Prepare params for Python
    const pythonParams = {
        bpm: options.bpm,
        ...params
    };

    // Call Python freezer
    const freezeFunc = pyodide.globals.get('freeze_drum_track');
    const pyResult = freezeFunc(
        JSON.stringify(sequence.steps),
        JSON.stringify(pythonParams),
        pyDrumType
    );
    const audioData = pyResult.toJs({ array_buffer_type: 'float32' });
    pyResult.destroy();

    // Create AudioBuffer from result
    const audioContext = new OfflineAudioContext(1, audioData.length, sampleRate);
    const buffer = audioContext.createBuffer(1, audioData.length, sampleRate);
    buffer.getChannelData(0).set(audioData);

    return buffer;
};

/**
 * Freezes a track using Web Audio's OfflineAudioContext
 * This is faster than Python for simple cases and works for live audio chains
 */
export const freezeWithOfflineContext = async (
    setupCallback: (ctx: OfflineAudioContext) => void,
    durationSeconds: number,
    sampleRate: number = 44100
): Promise<AudioBuffer> => {
    const lengthSamples = Math.ceil(durationSeconds * sampleRate);
    const offlineCtx = new OfflineAudioContext(2, lengthSamples, sampleRate);

    // Let user build their audio graph
    setupCallback(offlineCtx);

    // Render
    console.log('Rendering audio offline...');
    const renderedBuffer = await offlineCtx.startRendering();
    console.log('Render complete:', renderedBuffer.duration, 'seconds');

    return renderedBuffer;
};

/**
 * Converts an AudioBuffer to mono Float32Array (for loading into SustainProcessor)
 */
export const audioBufferToMono = (buffer: AudioBuffer): Float32Array => {
    if (buffer.numberOfChannels === 1) {
        return buffer.getChannelData(0);
    }

    // Attempt WASM optimization (Only supports standard Stereo -> Mono mix)
    if (wasmInstance && buffer.numberOfChannels === 2) {
        let leftPtr = 0;
        let rightPtr = 0;
        let outPtr = 0;

        try {
            const length = buffer.length;
            const leftData = buffer.getChannelData(0);
            const rightData = buffer.getChannelData(1);

            // Allocate and Pin to prevent GC during subsequent allocations
            leftPtr = wasmInstance.__new(length * 4, 0);
            wasmInstance.__pin(leftPtr);

            rightPtr = wasmInstance.__new(length * 4, 0);
            wasmInstance.__pin(rightPtr);

            outPtr = wasmInstance.__new(length * 4, 0);
            wasmInstance.__pin(outPtr);

            // Copy data to WASM
            const wasmMemoryBuffer = wasmInstance.memory.buffer;
            new Float32Array(wasmMemoryBuffer, leftPtr, length).set(leftData);
            new Float32Array(wasmMemoryBuffer, rightPtr, length).set(rightData);

            // Exec
            wasmInstance.mixToMono(leftPtr, rightPtr, outPtr, length);

            // Copy back
            const result = new Float32Array(length);
            result.set(new Float32Array(wasmMemoryBuffer, outPtr, length));

            return result;
        } catch (e) {
            console.warn("WASM audioBufferToMono failed, falling back to JS", e);
            // Fallthrough to JS
        } finally {
            // Clean up memory
            if (leftPtr) wasmInstance.__unpin(leftPtr);
            if (rightPtr) wasmInstance.__unpin(rightPtr);
            if (outPtr) wasmInstance.__unpin(outPtr);
        }
    }

    // Mix down to mono (JS Fallback)
    const mono = new Float32Array(buffer.length);
    const numChannels = buffer.numberOfChannels;

    for (let ch = 0; ch < numChannels; ch++) {
        const channelData = buffer.getChannelData(ch);
        for (let i = 0; i < buffer.length; i++) {
            mono[i] += channelData[i] / numChannels;
        }
    }

    return mono;
};

/**
 * Finds optimal loop points in an audio buffer
 * Uses zero-crossing detection for clean loops
 */
export const findLoopPoints = (
    buffer: Float32Array,
    minLoopLength: number = 4410 // ~100ms at 44.1kHz
): { start: number, end: number } => {
    // Attempt WASM optimization
    if (wasmInstance) {
        let bufferPtr = 0;
        try {
            const length = buffer.length;

            // Allocate & Pin
            bufferPtr = wasmInstance.__new(length * 4, 0);
            wasmInstance.__pin(bufferPtr);

            // Copy
            new Float32Array(wasmInstance.memory.buffer, bufferPtr, length).set(buffer);

            // Exec
            const packedResult = wasmInstance.findLoopPoints(bufferPtr, length, minLoopLength);

            // Unpack u64
            const start = Number((packedResult >> 32n) & 0xFFFFFFFFn);
            const end = Number(packedResult & 0xFFFFFFFFn);

            return { start, end };
        } catch (e) {
            console.warn("WASM findLoopPoints failed, falling back to JS", e);
        } finally {
            // Clean up
            if (bufferPtr) wasmInstance.__unpin(bufferPtr);
        }
    }

    /* --- OLD LOGIC (PRESERVED / ACTIVE FALLBACK) --- */
    const length = buffer.length;

    // Find a zero-crossing near the start (after ~10ms to avoid attack transient)
    const searchStart = Math.min(441, length - minLoopLength); // 10ms at 44.1kHz
    let loopStart = searchStart;

    for (let i = searchStart; i < length / 2; i++) {
        if (buffer[i] >= 0 && buffer[i - 1] < 0) {
            loopStart = i;
            break;
        }
    }

    // Find a zero-crossing near the end
    let loopEnd = length - 1;
    for (let i = length - 1; i > loopStart + minLoopLength; i--) {
        if (buffer[i] >= 0 && buffer[i - 1] < 0) {
            loopEnd = i;
            break;
        }
    }

    return { start: loopStart, end: loopEnd };
};
