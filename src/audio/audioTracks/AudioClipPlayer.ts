/**
 * Live audio clip playback, main-thread side (#1629 D4 static playback).
 *
 * The linear player calls `step()` once per song step, with the step's
 * context frame. The player keeps one worklet voice per sounding clip:
 *
 *   - a clip whose left edge is within `PREFETCH_SECONDS` gets a voice
 *     *prepared* ahead of time: its feed is filled from the frame it will
 *     start on, so the first block already has audio;
 *   - on the clip's first step (or any step inside it after a seek) the voice
 *     is *armed* with that step's exact frame, and its right edge predicted;
 *     a tempo change re-predicts the edge, an edit or a seek ends the voice
 *     (with a declick) and starts a fresh one;
 *   - the pager (`pump`) keeps every voice's feed full a page ahead, reading
 *     the media store a page at a time, so no clip is ever held whole.
 *
 * Mute / solo and the track fader are the worklet's strip gains: a muted
 * track keeps playing silently and comes back in sync.
 *
 * Pure of the DOM: the worklet port, the clock and the media reader are
 * injected (see `audioClipHost.ts` for the live wiring, and the tests).
 */

import type { Arrangement, AudioClip, AudioTrackKey } from '@/types/song';
import { isAudioClip } from '@/arrangement/model';
import { SabClipRing, type ClipVoiceSpec } from '@/shared/rt/audioClipVoice';
import { clipEndFrame, clipVoiceSpec, type StepClock } from './clipTiming';

/** How far ahead a clip's voice is prepared. */
export const PREFETCH_SECONDS = 1;
/** Frames one page read moves. */
export const PAGE_FRAMES = 8192;
/** A voice that stopped is reused only this long after its last frame. */
const VOICE_RELEASE_SECONDS = 0.25;

export interface ClipPort {
    postMessage(message: unknown, transfer?: Transferable[]): void;
}

export interface MediaReader {
    readFrames(id: string, from: number, count: number): Promise<Float32Array[] | null>;
}

export interface MediaFormat {
    sampleRate: number;
    frames: number;
}

export interface AudioClipPlayerOptions {
    port: ClipPort;
    reader: MediaReader;
    contextRate: number;
    /** The context frame now (`currentTime · sampleRate`). */
    now: () => number;
    voices: number;
    /** Frames each voice's feed holds. */
    capacity: number;
    /** One SAB ring per voice, or null to post pages to the worklet. */
    rings: SabClipRing[] | null;
    /** Output index of each audio track. */
    tracks: readonly AudioTrackKey[];
    /** Media id → format; null while unknown (the clip stays silent). */
    media: (id: string) => MediaFormat | null;
    /** Called once per media id the store does not hold. */
    onMissingMedia?: (id: string) => void;
}

export interface SongStepInfo {
    arrangement: Arrangement;
    /** Song step. */
    pos: number;
    /** Context frame the step sounds on. */
    frame: number;
    /** The clock's absolute step count (swing parity). */
    absStep: number;
    clock: StepClock;
    /** Loop point of the song (the step after `loopLength - 1` is 0). */
    loopLength: number;
}

type VoiceState = 'free' | 'prepared' | 'playing';

interface Voice {
    readonly index: number;
    gen: number;
    state: VoiceState;
    clip: AudioClip | null;
    /** Source frame the feed started at, and the next one to page in. */
    sourceStart: number;
    nextSource: number;
    sourceEnd: number;
    /** Frames handed to the feed since it was prepared. */
    written: number;
    rate: number;
    startFrame: number;
    endFrame: number;
    /** Song step the voice was armed on, and its clock parity. */
    armedPos: number;
    armedParity: number;
    reading: boolean;
    busyUntil: number;
}

// Arrangements are immutable: their audio clips are listed once per value.
const audioClipCache = new WeakMap<Arrangement, AudioClip[]>();
function audioClipsOf(arrangement: Arrangement): AudioClip[] {
    let clips = audioClipCache.get(arrangement);
    if (!clips) {
        clips = arrangement.clips.filter(isAudioClip);
        audioClipCache.set(arrangement, clips);
    }
    return clips;
}

/**
 * Same clip, same sound. By value: a doc → store projection (a peer's edit, an
 * undo) rebuilds every clip object, and a voice must not restart for that.
 */
function sameClip(a: AudioClip, b: AudioClip): boolean {
    return a === b || (a.id === b.id && a.track === b.track && a.mediaId === b.mediaId
        && a.startStep === b.startStep && a.lengthSteps === b.lengthSteps
        && (a.offsetSteps ?? 0) === (b.offsetSteps ?? 0) && a.offsetFrames === b.offsetFrames
        && a.gainDb === b.gainDb && (a.fadeInFrames ?? 0) === (b.fadeInFrames ?? 0)
        && (a.fadeOutFrames ?? 0) === (b.fadeOutFrames ?? 0) && a.warp === b.warp);
}

export function hasAudioClips(arrangement: Arrangement): boolean {
    return audioClipsOf(arrangement).length > 0;
}

export class AudioClipPlayer {
    private readonly opts: AudioClipPlayerOptions;
    private readonly voices: Voice[];
    private readonly missing = new Set<string>();
    private lastPos = -1;
    private readonly release: number;

    constructor(options: AudioClipPlayerOptions) {
        this.opts = options;
        this.release = Math.round(VOICE_RELEASE_SECONDS * options.contextRate);
        this.voices = Array.from({ length: options.voices }, (_, index): Voice => ({
            index, gen: 0, state: 'free', clip: null, sourceStart: 0, nextSource: 0, sourceEnd: 0,
            written: 0, rate: 1, startFrame: 0, endFrame: 0, armedPos: 0, armedParity: 0,
            reading: false, busyUntil: -Infinity,
        }));
    }

    /** Voices in use (prepared or playing), for tests and the HUD. */
    activeVoices(): { clipId: string; state: VoiceState }[] {
        return this.voices
            .filter((v) => v.state !== 'free' && v.clip)
            .map((v) => ({ clipId: (v.clip as AudioClip).id, state: v.state }));
    }

    private trackIndex(track: AudioTrackKey): number {
        return this.opts.tracks.indexOf(track);
    }

    private allocate(now: number): Voice | null {
        let best: Voice | null = null;
        for (const v of this.voices) {
            if (v.state === 'free' && v.busyUntil <= now && (!best || v.busyUntil < best.busyUntil)) best = v;
        }
        return best;
    }

    /** Reserve `voice` for `clip`, its feed starting at `sourceStart`. */
    private prepare(voice: Voice, clip: AudioClip, sourceStart: number, rate: number, media: MediaFormat): void {
        voice.gen = (voice.gen + 1) | 0;
        voice.state = 'prepared';
        voice.clip = clip;
        voice.sourceStart = sourceStart;
        voice.nextSource = Math.max(0, sourceStart);
        voice.sourceEnd = media.frames;
        voice.written = 0;
        voice.rate = rate;
        voice.reading = false;
        // The worklet does not read a voice that is not armed, so its ring can be reset here.
        this.opts.rings?.[voice.index].reset();
        this.opts.port.postMessage({ t: 'prepare', v: voice.index, gen: voice.gen });
    }

    private arm(voice: Voice, spec: ClipVoiceSpec, pos: number, parity: number): void {
        const clip = voice.clip as AudioClip;
        voice.state = 'playing';
        voice.startFrame = spec.startFrame;
        voice.endFrame = spec.endFrame;
        voice.armedPos = pos;
        voice.armedParity = parity;
        this.opts.port.postMessage({ t: 'arm', v: voice.index, gen: voice.gen, track: this.trackIndex(clip.track), spec });
    }

    /** End a voice at `frame` (declicked); the slot frees once it is silent. */
    private endVoice(voice: Voice, frame: number): void {
        if (voice.state === 'playing' && frame < voice.endFrame) {
            this.opts.port.postMessage({ t: 'end', v: voice.index, gen: voice.gen, endFrame: frame, clipEndFrame: voice.endFrame });
            voice.endFrame = frame;
        }
        this.freeVoice(voice, voice.state === 'playing' ? voice.endFrame : -Infinity);
    }

    private freeVoice(voice: Voice, lastFrame: number): void {
        voice.gen = (voice.gen + 1) | 0;
        voice.state = 'free';
        voice.clip = null;
        voice.reading = false;
        voice.busyUntil = lastFrame + this.release;
    }

    /** Stop everything at `frame` (transport stop, or the linear player switched off). */
    stopAll(frame = this.opts.now()): void {
        this.opts.port.postMessage({ t: 'stopAll', atFrame: frame });
        for (const v of this.voices) {
            if (v.state === 'playing') this.freeVoice(v, Math.min(v.endFrame, frame));
            else if (v.state === 'prepared') this.freeVoice(v, -Infinity);
        }
        this.lastPos = -1;
    }

    step(info: SongStepInfo): void {
        const { arrangement, pos, frame, absStep, clock, loopLength } = info;
        const rate = this.opts.contextRate;
        const parityAt = (step: number) => (absStep + step - pos) & 1;
        const continuous = this.lastPos >= 0 && (pos === this.lastPos + 1 || (pos === 0 && this.lastPos === loopLength - 1));
        this.lastPos = pos;
        if (!continuous) {
            for (const v of this.voices) if (v.state !== 'free') this.endVoice(v, frame);
        }
        const clips = audioClipsOf(arrangement);
        const byId = new Map<string, AudioClip>();
        for (const clip of clips) byId.set(clip.id, clip);

        // Voices that ended, or whose clip was edited or removed (an equal clip rebuilt by a load keeps its voice).
        for (const v of this.voices) {
            if (v.state === 'free') continue;
            const clip = v.clip as AudioClip;
            if (v.state === 'playing' && v.endFrame <= frame) {
                this.freeVoice(v, v.endFrame);
                continue;
            }
            const current = byId.get(clip.id);
            if (!current || !sameClip(current, clip)) {
                this.endVoice(v, frame);
                continue;
            }
            v.clip = current;
            if (v.state === 'playing') {
                // A tempo change moves the clip's right edge.
                const end = clipEndFrame(clip, pos, frame, parityAt(pos), clock, rate);
                if (Math.abs(end - v.endFrame) > 1) {
                    this.opts.port.postMessage({ t: 'end', v: v.index, gen: v.gen, endFrame: end, clipEndFrame: end });
                    v.endFrame = end;
                }
            }
        }

        const voiceFor = (id: string) => this.voices.find((v) => v.state !== 'free' && v.clip?.id === id) ?? null;
        const formatOf = (clip: AudioClip): MediaFormat | null => {
            const media = this.opts.media(clip.mediaId);
            if (!media && !this.missing.has(clip.mediaId)) {
                this.missing.add(clip.mediaId);
                this.opts.onMissingMedia?.(clip.mediaId);
            }
            return media;
        };

        // Clips sounding at `pos`.
        for (const clip of clips) {
            if (pos < clip.startStep || pos >= clip.startStep + clip.lengthSteps || this.trackIndex(clip.track) < 0) continue;
            const existing = voiceFor(clip.id);
            if (existing?.state === 'playing') continue;
            const media = formatOf(clip);
            if (!media) continue;
            const placed = clipVoiceSpec(clip, pos, frame, parityAt, clock, rate, media);
            if (!placed) continue;
            let voice = existing;
            if (voice && voice.sourceStart !== placed.sourceStart) {
                this.endVoice(voice, frame);
                voice = null;
            }
            if (!voice) {
                voice = this.allocate(frame);
                if (!voice) continue;
                this.prepare(voice, clip, placed.sourceStart, placed.spec.rate, media);
            }
            this.arm(voice, placed.spec, pos, parityAt(pos));
        }

        // Clips starting within the prefetch window (across the loop point too).
        const stepSeconds = 60 / (Math.max(1, clock.tempo) * 4);
        const horizon = Math.max(1, Math.ceil(PREFETCH_SECONDS / stepSeconds));
        for (const clip of clips) {
            if (this.trackIndex(clip.track) < 0 || voiceFor(clip.id)) continue;
            let ahead = clip.startStep - pos;
            if (ahead <= 0 && loopLength > 0) ahead += loopLength;
            if (ahead <= 0 || ahead > horizon) continue;
            const media = formatOf(clip);
            if (!media) continue;
            const startParity = parityAt(pos + ahead);
            const placed = clipVoiceSpec(
                clip, clip.startStep, 0, (s) => (startParity + s - clip.startStep) & 1, clock, rate, media,
            );
            const voice = placed ? this.allocate(frame) : null;
            if (placed && voice) this.prepare(voice, clip, placed.sourceStart, placed.spec.rate, media);
        }

        void this.pump();
    }

    /** Free space of a voice's feed now. */
    private space(voice: Voice): number {
        const ring = this.opts.rings?.[voice.index];
        if (ring) return ring.writable();
        const consumed = voice.state === 'playing'
            ? Math.max(0, (this.opts.now() - voice.startFrame) * voice.rate)
            : 0;
        return Math.max(0, this.opts.capacity - (voice.written - Math.floor(consumed)));
    }

    /** Page media into every voice's feed that has room. Resolves when the reads land. */
    pump(): Promise<void> {
        const reads: Promise<void>[] = [];
        for (const voice of this.voices) {
            if (voice.state === 'free' || voice.reading || !voice.clip || voice.nextSource >= voice.sourceEnd) continue;
            const room = this.space(voice);
            // Small top-ups wait for a page's worth of room, except the first fill.
            if (room <= 0 || (room < PAGE_FRAMES && voice.written > 0)) continue;
            const count = Math.min(room, PAGE_FRAMES, voice.sourceEnd - voice.nextSource);
            const gen = voice.gen;
            const from = voice.nextSource;
            const mediaId = voice.clip.mediaId;
            voice.reading = true;
            reads.push(this.opts.reader.readFrames(mediaId, from, count).then((data) => {
                if (voice.gen !== gen) return;
                voice.reading = false;
                if (!data || data.length === 0) {
                    if (!this.missing.has(mediaId)) {
                        this.missing.add(mediaId);
                        this.opts.onMissingMedia?.(mediaId);
                    }
                    voice.nextSource = voice.sourceEnd;
                    return;
                }
                const n = data[0].length;
                const ring = this.opts.rings?.[voice.index];
                if (ring) {
                    ring.write(data[0], data[1] ?? null, 0, n);
                } else {
                    const l = data[0];
                    const r = data[1] ?? null;
                    this.opts.port.postMessage(
                        { t: 'chunk', v: voice.index, gen, l, r },
                        r ? [l.buffer, r.buffer] : [l.buffer],
                    );
                }
                voice.written += n;
                voice.nextSource = from + n;
            }, () => {
                if (voice.gen === gen) voice.reading = false;
            }));
        }
        return Promise.all(reads).then(() => undefined);
    }

    /** True while any voice still needs pages (the host keeps its pump timer running). */
    busy(): boolean {
        return this.voices.some((v) => v.state !== 'free');
    }
}
