/**
 * An audio file → the media store (#1629 P1 import).
 *
 * WAV / RF64 decode losslessly in `wav.ts` (exact samples, the file's own
 * rate). Every other format the browser reads (FLAC, MP3, Ogg, AAC, …) goes
 * through `decodeAudioData` on an `OfflineAudioContext` at the live context's
 * rate, which is the rate it plays at anyway. More than two channels are mixed
 * down to stereo (even channels left, odd right): every audio track is a
 * stereo strip.
 */

import type { MediaRef } from '@/types/song';
import { createOfflineContext } from '@/audio/offline/createOfflineContext';
import { audioRuntime } from '@/audio/runtime/AudioRuntime';
import { decodeWav, type DecodedAudio } from './wav';
import { mediaStore, type MediaStore } from './MediaStore';

/** Longest audio an import accepts (a full album side, not a mistake). */
export const MAX_IMPORT_SECONDS = 60 * 60;

export interface ImportedMedia {
    mediaId: string;
    ref: MediaRef;
    /** False when the store already held this audio. */
    created: boolean;
    /** How it was decoded. */
    decoder: 'wav' | 'browser';
}

export interface ImportAudioOptions {
    store?: MediaStore;
    /** Browser decode for non-WAV files; injected in tests. */
    decodeWithBrowser?: (bytes: ArrayBuffer) => Promise<DecodedAudio>;
}

/** Up to two channels; more are averaged into left (even) and right (odd). */
export function toStereo(channels: Float32Array[]): Float32Array[] {
    if (channels.length <= 2) return channels;
    const frames = channels[0].length;
    const out = [new Float32Array(frames), new Float32Array(frames)];
    const counts = [0, 0];
    channels.forEach((ch, i) => {
        const dst = out[i & 1];
        counts[i & 1]++;
        for (let f = 0; f < frames; f++) dst[f] += ch[f];
    });
    for (let s = 0; s < 2; s++) {
        const k = 1 / counts[s];
        for (let f = 0; f < frames; f++) out[s][f] *= k;
    }
    return out;
}

async function browserDecode(bytes: ArrayBuffer): Promise<DecodedAudio> {
    const sampleRate = audioRuntime.context?.sampleRate;
    const context = createOfflineContext({ channels: 2, length: 1, ...(sampleRate ? { sampleRate } : {}) });
    const buffer = await context.decodeAudioData(bytes);
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c).slice());
    return { sampleRate: buffer.sampleRate, channels };
}

/** Decode `file` and put it into the media store. Throws with a message a user can read. */
export async function importAudioFile(
    file: Blob & { name?: string },
    options: ImportAudioOptions = {},
): Promise<ImportedMedia> {
    const store = options.store ?? mediaStore;
    const name = file.name ?? 'audio';
    const buffer = await file.arrayBuffer();
    let decoder: ImportedMedia['decoder'] = 'wav';
    let decoded = decodeWav(new Uint8Array(buffer));
    if (!decoded) {
        decoder = 'browser';
        try {
            decoded = await (options.decodeWithBrowser ?? browserDecode)(buffer);
        } catch (err) {
            throw new Error(`${name}: not an audio file this browser can decode (${err instanceof Error ? err.message : String(err)})`);
        }
    }
    const frames = decoded.channels[0]?.length ?? 0;
    if (frames === 0) throw new Error(`${name}: the file holds no audio`);
    if (frames / decoded.sampleRate > MAX_IMPORT_SECONDS) {
        throw new Error(`${name}: longer than ${MAX_IMPORT_SECONDS / 60} minutes`);
    }
    const planar = toStereo(decoded.channels);
    const stored = await store.put(planar, decoded.sampleRate);
    return {
        mediaId: stored.id,
        ref: { name, sampleRate: stored.sampleRate, channels: stored.channels, frames: stored.frames },
        created: stored.created,
        decoder,
    };
}
