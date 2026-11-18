/**
 * Buffer helpers of the stem export (moved out of `stemExport.ts` for the
 * module-size budget when audio-track stems joined it, #1629).
 */
import type { AudioTrackKey } from '../types';
import { createOfflineBuffer } from '../audio/offline/createOfflineContext';

/** Stems a song can export: the fixed ones, then one per audio track. */
export type StemId =
    | 'partA'
    | 'partB'
    | 'bass2'
    | 'drums'
    | `sampler-bank-${number}`
    | AudioTrackKey
    | 'master';

/** An all-zero stem, used in place of rendering a track the mix has silenced. */
export function silentBuffer(targetLength: number, sampleRate: number): AudioBuffer {
    return createOfflineBuffer({ channels: 2, length: targetLength, sampleRate });
}

export function throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) {
        throw new DOMException('Export cancelled', 'AbortError');
    }
}

export function alignBufferLength(buffer: AudioBuffer, targetLength: number, sampleRate: number): AudioBuffer {
    if (buffer.length === targetLength) return buffer;

    const channels = buffer.numberOfChannels;
    const out = createOfflineBuffer({ channels, length: targetLength, sampleRate });

    for (let ch = 0; ch < channels; ch++) {
        const src = buffer.getChannelData(ch);
        const dst = out.getChannelData(ch);
        const copyLen = Math.min(src.length, targetLength);
        dst.set(src.subarray(0, copyLen));
    }

    return out;
}

/** Wrap mix-bus output channels in an AudioBuffer for the WAV encoder. */
export function channelsToBuffer(channels: Float32Array[], targetLength: number, sampleRate: number): AudioBuffer {
    const count = channels.length;
    const out = createOfflineBuffer({ channels: count, length: targetLength, sampleRate });
    for (let ch = 0; ch < count; ch++) {
        out.getChannelData(ch).set(channels[ch].subarray(0, out.length));
    }
    return out;
}

export function stemFileName(id: StemId): string {
    return `stems/${id}.wav`;
}

export function downloadBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}
