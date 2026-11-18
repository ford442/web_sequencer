/**
 * Audio clips in an offline render (#1629 D6): every audio track of the
 * arrangement as one stereo buffer, rendered with the voice DSP the worklet
 * runs (`shared/rt/audioClipVoice.ts`) on the frames the live player arms it
 * on (`clipTiming.ts`), so a bounce plays what the transport played.
 *
 * Offline renders hold the whole song anyway, so a clip's source is read in
 * one piece (`ArrayClipFeed`) rather than paged.
 */

import type { Arrangement, AudioClip, AudioTrack, AudioTrackKey } from '@/types/song';
import { isAudioClip } from '@/arrangement/model';
import { ArrayClipFeed, ClipVoice, stripGains } from '@/shared/rt/audioClipVoice';
import { clipVoiceSpec, stepSpanSeconds, type StepClock } from './clipTiming';
import type { MediaFormat } from './AudioClipPlayer';

export interface OfflineMedia extends MediaFormat {
    channels: Float32Array[];
}

export interface RenderAudioTracksOptions {
    arrangement: Arrangement;
    tracks: readonly AudioTrack[];
    clock: StepClock;
    sampleRate: number;
    /** Frames to render (the export length). */
    frames: number;
    /** Context frame of song step 0 (default 0). */
    songStartFrame?: number;
    /** Media id → its audio, or null when the store does not hold it. */
    loadMedia: (id: string) => Promise<OfflineMedia | null>;
    /** A track is rendered only if this says so (mute / solo). Default: all. */
    isAudible?: (track: AudioTrackKey) => boolean;
}

export interface RenderedAudioTrack {
    track: AudioTrackKey;
    left: Float32Array;
    right: Float32Array;
}

export interface RenderAudioTracksResult {
    tracks: RenderedAudioTrack[];
    /** Media ids the store did not hold (their clips are silent). */
    missingMedia: string[];
}

/** Context frame of song step `step`, the frame the transport clock puts it on. */
export function songStepFrame(step: number, clock: StepClock, sampleRate: number, songStartFrame = 0): number {
    // The clock fires a step on the first whole frame at or after its exact time.
    return songStartFrame + Math.ceil(stepSpanSeconds(0, step, 0, clock) * sampleRate - 1e-6);
}

const BLOCK = 128;

/** Render every audible audio track that has clips. Tracks with none are left out. */
export async function renderAudioTracksOffline(options: RenderAudioTracksOptions): Promise<RenderAudioTracksResult> {
    const { arrangement, clock, sampleRate, frames } = options;
    const start = options.songStartFrame ?? 0;
    const clips = arrangement.clips.filter(isAudioClip);
    const strips = new Map(options.tracks.map((t) => [t.id, t]));
    const media = new Map<string, OfflineMedia | null>();
    for (const clip of clips) {
        if (!media.has(clip.mediaId)) media.set(clip.mediaId, await options.loadMedia(clip.mediaId));
    }
    const byTrack = new Map<AudioTrackKey, AudioClip[]>();
    for (const clip of clips) {
        if (!strips.has(clip.track) || options.isAudible?.(clip.track) === false) continue;
        const list = byTrack.get(clip.track) ?? [];
        list.push(clip);
        byTrack.set(clip.track, list);
    }

    const out: RenderedAudioTrack[] = [];
    const voice = new ClipVoice(BLOCK);
    // Song steps start on even clock parity: the clock counts from PLAY at step 0.
    const parityAt = (step: number) => step & 1;
    for (const [track, trackClips] of byTrack) {
        const left = new Float32Array(frames);
        const right = new Float32Array(frames);
        for (const clip of trackClips) {
            const source = media.get(clip.mediaId);
            if (!source) continue;
            const frame = songStepFrame(clip.startStep, clock, sampleRate, start);
            const placed = clipVoiceSpec(clip, clip.startStep, frame, parityAt, clock, sampleRate, source);
            if (!placed) continue;
            voice.start(placed.spec, 0);
            const feed = new ArrayClipFeed(source.channels, placed.sourceStart);
            const blockL = new Float32Array(BLOCK);
            const blockR = new Float32Array(BLOCK);
            // Blocks on the same 128-frame grid the worklet renders on.
            for (let at = Math.floor(placed.spec.startFrame / BLOCK) * BLOCK; at < frames && voice.active; at += BLOCK) {
                blockL.fill(0);
                blockR.fill(0);
                voice.render(feed, blockL, blockR, at, BLOCK);
                const n = Math.min(BLOCK, frames - at);
                for (let i = Math.max(0, -at); i < n; i++) {
                    left[at + i] += blockL[i];
                    right[at + i] += blockR[i];
                }
            }
        }
        const strip = stripGains(strips.get(track)?.gainDb ?? 0, strips.get(track)?.pan ?? 0);
        for (let i = 0; i < frames; i++) {
            left[i] *= strip.l;
            right[i] *= strip.r;
        }
        out.push({ track, left, right });
    }
    const missingMedia = [...media.entries()].filter(([, m]) => !m).map(([id]) => id);
    return { tracks: out, missingMedia };
}
