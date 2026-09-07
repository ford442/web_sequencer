// @mode: bridge
// @migrate-target: assemblyscript
// @perf-bottleneck: Hot loop in audioBufferToWav - sample clamping and conversion
// @note-for-ai: WASM bridge implementation for audio export. Uses WASM for sample
// conversion when available, falls back to JS on error or if WASM not loaded.

import initAudioExport from '../wasm/audioExport.wasm?init';
import { engineTelemetry } from '@/utils/engineTelemetry';
import { resampleAudioBuffer } from './resampleAudioBuffer';

export { resampleAudioBuffer } from './resampleAudioBuffer';

// WASM Module Loader
interface WasmExports {
    memory: WebAssembly.Memory;
    floatToInt16: (inputPtr: number, outputPtr: number, length: number) => void;
    interleaveChannels: (
        channelPtrsPtr: number,
        numChannels: number,
        outputPtr: number,
        frameCount: number
    ) => void;
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
        const instance = await initAudioExport({
            env: {
                abort: () => console.error("WASM Abort")
            }
        });
        wasmInstance = instance.exports as unknown as WasmExports;
        try { engineTelemetry.registerResolution('audioExport','wasm','loaded'); } catch (e) { /* noop */ }
    } catch (e) {
        try { engineTelemetry.registerResolution('audioExport','js','failed to load wasm: ' + String(e)); } catch (err) { /* noop */ }
        console.warn("Failed to load audioExport.wasm, using JS fallback", e);
    }
};

// Initialize WASM in background
if (typeof window !== 'undefined') {
    void loadWasm();
}

// @perf-optimized: Hoist endianness check to module scope to avoid repeated allocation
const IS_LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

export type WavBitDepth = 16 | 24;

export interface WavEncodeOptions {
    /** Target sample rate. Resamples when different from the buffer rate. */
    sampleRate?: 44100 | 48000;
    /** PCM bit depth. Defaults to 16. */
    bitDepth?: WavBitDepth;
}

export async function audioBufferToWav(
    buffer: AudioBuffer,
    options: WavEncodeOptions = {},
): Promise<Blob> {
    const bitDepth = options.bitDepth ?? 16;
    const targetSampleRate = options.sampleRate ?? buffer.sampleRate;
    const workingBuffer = targetSampleRate === buffer.sampleRate
        ? buffer
        : await resampleAudioBuffer(buffer, targetSampleRate);

    const bytesPerSample = bitDepth / 8;
    const numOfChan = workingBuffer.numberOfChannels;
    const length = workingBuffer.length * numOfChan * bytesPerSample + 44;
    const out = new ArrayBuffer(length);
    const view = new DataView(out);
    const channels: Float32Array[] = [];
    let offset = 0;
    let pos = 0;

    // Write WAV Header
    setUint32(0x46464952); // "RIFF"
    setUint32(length - 8); // file length - 8
    setUint32(0x45564157); // "WAVE"

    setUint32(0x20746d66); // "fmt " chunk
    setUint32(16); // length = 16
    setUint16(1); // PCM (uncompressed)
    setUint16(numOfChan);
    setUint32(workingBuffer.sampleRate);
    setUint32(workingBuffer.sampleRate * bytesPerSample * numOfChan); // avg. bytes/sec
    setUint16(numOfChan * bytesPerSample); // block-align
    setUint16(bitDepth);

    setUint32(0x61746164); // "data" - chunk
    setUint32(length - pos - 4); // chunk length

    // Write Interleaved Data
    for (let i = 0; i < workingBuffer.numberOfChannels; i++)
        channels.push(workingBuffer.getChannelData(i));

    const len = workingBuffer.length;

    if (bitDepth === 16 && IS_LITTLE_ENDIAN) {
        const sampleData = new Int16Array(out, 44);
        const wasmSuccess = tryWasmInterleave(channels, sampleData, numOfChan, len);

        if (!wasmSuccess) {
            jsInterleave(channels, sampleData, numOfChan, len);
        }
    } else if (bitDepth === 16) {
        let sampleIndex = 0;
        while (sampleIndex < len) {
            for (let i = 0; i < numOfChan; i++) {
                let s = channels[i][sampleIndex];
                if (s > 1.0) s = 1.0;
                else if (s < -1.0) s = -1.0;
                s = (s < 0 ? s * 32768 : s * 32767) | 0;
                view.setInt16(44 + offset, s, true);
                offset += 2;
            }
            sampleIndex++;
        }
    } else {
        writeInterleaved24Bit(view, channels, numOfChan, len, 44);
    }

    return new Blob([out], { type: 'audio/wav' });

    function setUint16(data: number) {
        view.setUint16(pos, data, true);
        pos += 2;
    }

    function setUint32(data: number) {
        view.setUint32(pos, data, true);
        pos += 4;
    }
}

/**
 * Attempts to use WASM for channel interleaving and sample conversion.
 * Returns true on success, false to fall back to JS.
 */
function tryWasmInterleave(
    channels: Float32Array[],
    output: Int16Array,
    numOfChan: number,
    len: number
): boolean {
    if (!wasmInstance) {
        return false;
    }

    // Pointers to track for cleanup
    const ptrsToUnpin: number[] = [];
    
    try {
        const wasm = wasmInstance;
        const channelPtrs: number[] = [];
        
        // Allocate and copy channel data
        for (let i = 0; i < numOfChan; i++) {
            const chData = channels[i];
            const chPtr = wasm.__new(chData.length * 4, 0);
            wasm.__pin(chPtr);
            ptrsToUnpin.push(chPtr);
            channelPtrs.push(chPtr);
            
            // Copy data to WASM memory
            new Float32Array(wasm.memory.buffer, chPtr, chData.length).set(chData);
        }
        
        // Allocate array of channel pointers
        const channelPtrsArrayPtr = wasm.__new(numOfChan * 8, 0); // 8 bytes per usize
        wasm.__pin(channelPtrsArrayPtr);
        ptrsToUnpin.push(channelPtrsArrayPtr);
        
        // Write channel pointers to the array
        const ptrArrayView = new BigUint64Array(wasm.memory.buffer, channelPtrsArrayPtr, numOfChan);
        for (let i = 0; i < numOfChan; i++) {
            ptrArrayView[i] = BigInt(channelPtrs[i]);
        }
        
        // Allocate output buffer
        const outputLength = len * numOfChan;
        const outputPtr = wasm.__new(outputLength * 2, 0); // 2 bytes per i16
        wasm.__pin(outputPtr);
        ptrsToUnpin.push(outputPtr);
        
        // Call WASM function
        wasm.interleaveChannels(channelPtrsArrayPtr, numOfChan, outputPtr, len);
        
        // Copy result back to JS
        const wasmOutput = new Int16Array(wasm.memory.buffer, outputPtr, outputLength);
        output.set(wasmOutput);
        
        return true;
    } catch (e) {
        console.warn("WASM interleave failed, falling back to JS", e);
        return false;
    } finally {
        // Cleanup: unpin all allocated memory
        if (wasmInstance) {
            for (const ptr of ptrsToUnpin) {
                wasmInstance.__unpin(ptr);
            }
        }
    }
}

/**
 * Original JS interleaving logic (fallback when WASM is unavailable or fails).
 * Preserved from original implementation.
 */
function writeInterleaved24Bit(
    view: DataView,
    channels: Float32Array[],
    numOfChan: number,
    len: number,
    dataOffset: number,
): void {
    let offset = 0;
    for (let i = 0; i < len; i++) {
        for (let ch = 0; ch < numOfChan; ch++) {
            let s = channels[ch][i];
            if (s > 1.0) s = 1.0;
            else if (s < -1.0) s = -1.0;
            const scaled = s < 0 ? s * 0x800000 : s * 0x7fffff;
            const intVal = scaled | 0;
            const byteOffset = dataOffset + offset;
            view.setUint8(byteOffset, intVal & 0xff);
            view.setUint8(byteOffset + 1, (intVal >> 8) & 0xff);
            view.setUint8(byteOffset + 2, (intVal >> 16) & 0xff);
            offset += 3;
        }
    }
}

function jsInterleave(
    channels: Float32Array[],
    sampleData: Int16Array,
    numOfChan: number,
    len: number
): void {
    let outputIndex = 0;

    // OPTIMIZATION: Unroll loops for common Mono and Stereo cases
    // This avoids repeated array lookups and branch checks in the hot loop
    if (numOfChan === 2) {
        const ch0 = channels[0];
        const ch1 = channels[1];
        for (let i = 0; i < len; i++) {
            let s = ch0[i];
            // Clamp & Scale Left
            if (s > 1.0) s = 1.0; else if (s < -1.0) s = -1.0;
            sampleData[outputIndex++] = s < 0 ? s * 32768 : s * 32767;

            s = ch1[i];
            // Clamp & Scale Right
            if (s > 1.0) s = 1.0; else if (s < -1.0) s = -1.0;
            sampleData[outputIndex++] = s < 0 ? s * 32768 : s * 32767;
        }
    } else if (numOfChan === 1) {
        const ch0 = channels[0];
        for (let i = 0; i < len; i++) {
            let s = ch0[i];
            // Clamp & Scale
            if (s > 1.0) s = 1.0; else if (s < -1.0) s = -1.0;
            sampleData[outputIndex++] = s < 0 ? s * 32768 : s * 32767;
        }
    } else {
        // General case for N channels
        for (let i = 0; i < len; i++) {
            for (let ch = 0; ch < numOfChan; ch++) {
                let s = channels[ch][i];

                // Clamp
                if (s > 1.0) s = 1.0;
                else if (s < -1.0) s = -1.0;

                // Scale to 16-bit integer
                s = s < 0 ? s * 32768 : s * 32767;

                sampleData[outputIndex++] = s;
            }
        }
    }
}

export function blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}
