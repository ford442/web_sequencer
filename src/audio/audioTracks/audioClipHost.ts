/**
 * The live audio clip path (#1629): owns the `audio-clip-processor` node and
 * the `AudioClipPlayer` that drives it, and connects them to the app.
 *
 *   engine boot   `attach(context, graph)`: the node's output i is plugged into
 *                 the patch's `audioTrackVoice` socket for `audio-(i+1)`.
 *   lazy          the worklet module and node exist only once the song has an
 *                 audio clip, so a song without audio pays nothing.
 *   linear player `onSongStep` from `useStepHandler` on every song step;
 *                 `offSong` when the transport plays a pattern or the session;
 *                 `stopAll` on transport stop.
 *   strips        fader, pan, mute and solo (`audioTrackStore`,
 *                 `trackMuteSoloStore`) go to the worklet as strip gains.
 *   pager         a timer keeps every voice's feed a page ahead while any plays.
 *
 * Feeds are SAB rings on a crossOriginIsolated page, posted pages otherwise.
 */

import { AUDIO_TRACK_KEYS } from '@/constants/song';
import type { Arrangement } from '@/types/song';
import type { CompiledAudioGraph } from '@/audio/graph/types';
import { findEngineVoice } from '@/audio/graph/engineVoices';
import { loadWorkletModule } from '@/audio/runtime/workletRegistry';
import { mediaStore } from '@/audio/media/MediaStore';
import { AUDIO_CLIP_PROCESSOR_NAME, SabClipRing, ringBytes, stripGains } from '@/shared/rt/audioClipVoice';
import { arrangementEnd } from '@/arrangement/model';
import { referencedMedia } from '@/arrangement/audioTracks';
import { arrangementStore } from '@/stores/songRecordStore';
import { audioTrackStore } from '@/stores/audioTrackStore';
import { trackMuteSoloStore } from '@/stores/trackMuteSoloStore';
import { transportMixStore } from '@/stores/transportMixStore';
import { engineDegradationStore } from '@/stores/engineDegradationStore';
import { swingPercentToClock } from '@/utils/musicTheory';
import { AudioClipPlayer, hasAudioClips, type MediaFormat } from './AudioClipPlayer';

const VOICES = 24;
/** Frames per voice feed: ~0.68 s at 48 kHz, refilled every `PUMP_MS`. */
const CAPACITY = 32768;
const PUMP_MS = 50;

function sharedMemory(): boolean {
    return typeof SharedArrayBuffer !== 'undefined'
        && (globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated === true;
}

class AudioClipHost {
    private context: AudioContext | null = null;
    private graph: CompiledAudioGraph | null = null;
    private node: AudioWorkletNode | null = null;
    private player: AudioClipPlayer | null = null;
    private loading: Promise<void> | null = null;
    private timer: ReturnType<typeof setInterval> | null = null;
    private offs: (() => void)[] = [];
    private readonly formats = new Map<string, MediaFormat>();
    private readonly lookedUp = new Set<string>();
    private readonly strips: number[] = [];
    private missing = 0;

    /** The engine came up: remember where to plug in; build the node if the song has audio. */
    attach(context: AudioContext, graph: CompiledAudioGraph): void {
        this.detach();
        this.context = context;
        this.graph = graph;
        const onArrangement = () => {
            const arrangement = arrangementStore.getSnapshot();
            this.lookUpMedia(arrangement);
            if (hasAudioClips(arrangement)) void this.ensure();
        };
        this.offs.push(arrangementStore.subscribe(onArrangement));
        this.offs.push(audioTrackStore.subscribe(() => this.pushStrips()));
        this.offs.push(trackMuteSoloStore.subscribe(() => this.pushStrips()));
        onArrangement();
    }

    /** Engine teardown: drop the node with the context. */
    detach(): void {
        this.offs.splice(0).forEach((off) => off());
        if (this.timer) clearInterval(this.timer);
        this.timer = null;
        try {
            this.node?.disconnect();
            this.node?.port.close();
        } catch { /* context already closed */ }
        this.node = null;
        this.player = null;
        this.loading = null;
        this.context = null;
        this.graph = null;
        this.strips.length = 0;
    }

    /** Media formats from the store, for every clip's media (the song's table is the fallback). */
    private lookUpMedia(arrangement: Arrangement): void {
        for (const id of referencedMedia(arrangement)) {
            if (this.lookedUp.has(id)) continue;
            this.lookedUp.add(id);
            void mediaStore.info(id).then((info) => {
                if (info) this.formats.set(id, { sampleRate: info.sampleRate, frames: info.frames });
            });
        }
    }

    private formatOf(id: string): MediaFormat | null {
        const known = this.formats.get(id);
        if (known) return known;
        const ref = audioTrackStore.getSnapshot().media[id];
        return ref ? { sampleRate: ref.sampleRate, frames: ref.frames } : null;
    }

    private reportMissing(): void {
        this.missing++;
        engineDegradationStore.report({
            id: 'audio-clip-media',
            subsystem: 'audio-clips',
            category: 'audio',
            message: 'Audio clips: media missing',
            reason: `${this.missing} audio file(s) the song uses are not in this browser's media store; their clips are silent`,
            status: 'active',
            activeBackend: 'silent',
            requestedBackend: 'media-store',
            retryable: false,
        });
    }

    private ensure(): Promise<void> {
        const { context, graph } = this;
        if (this.player || !context || !graph) return Promise.resolve();
        this.loading ??= (async () => {
            const { default: url } = await import('../../audio-worklets/audio-clip-processor.ts?worker&url');
            await loadWorkletModule(context, url, AUDIO_CLIP_PROCESSOR_NAME);
            if (this.context !== context) return;
            const sab = sharedMemory() ? new SharedArrayBuffer(ringBytes(CAPACITY) * VOICES) : null;
            const tracks = AUDIO_TRACK_KEYS.length;
            const node = new AudioWorkletNode(context, AUDIO_CLIP_PROCESSOR_NAME, {
                numberOfInputs: 0,
                numberOfOutputs: tracks,
                outputChannelCount: Array.from({ length: tracks }, () => 2),
                processorOptions: { voices: VOICES, tracks, capacity: CAPACITY, sab },
            });
            AUDIO_TRACK_KEYS.forEach((key, i) => {
                findEngineVoice(graph, 'audioTrackVoice', key)?.attach({ connect: (dest) => node.connect(dest, i) });
            });
            node.port.onmessage = (e: MessageEvent<{ t?: string; frames?: number }>) => {
                if (e.data?.t === 'underrun') console.warn(`[audio clips] ${e.data.frames} frames played late (a page was slow)`);
            };
            this.node = node;
            this.player = new AudioClipPlayer({
                port: node.port,
                reader: mediaStore,
                contextRate: context.sampleRate,
                now: () => Math.round(context.currentTime * context.sampleRate),
                voices: VOICES,
                capacity: CAPACITY,
                rings: sab ? Array.from({ length: VOICES }, (_, v) => new SabClipRing(sab, v * ringBytes(CAPACITY), CAPACITY)) : null,
                tracks: AUDIO_TRACK_KEYS,
                media: (id) => this.formatOf(id),
                onMissingMedia: () => this.reportMissing(),
            });
            this.strips.length = 0;
            this.pushStrips();
        })().catch((err: unknown) => {
            // loadWorkletModule reports a failed module; anything else is logged here.
            console.warn('[audio clips] player unavailable:', err);
            this.loading = null;
        });
        return this.loading;
    }

    /** Fader, pan, mute and solo of every track, sent only when they change. */
    private pushStrips(): void {
        const node = this.node;
        if (!node) return;
        const { tracks } = audioTrackStore.getSnapshot();
        AUDIO_TRACK_KEYS.forEach((key, i) => {
            const track = tracks.find((t) => t.id === key);
            const gains = track && trackMuteSoloStore.isAudible(key) ? stripGains(track.gainDb, track.pan) : { l: 0, r: 0 };
            if (this.strips[i * 2] === gains.l && this.strips[i * 2 + 1] === gains.r) return;
            this.strips[i * 2] = gains.l;
            this.strips[i * 2 + 1] = gains.r;
            node.port.postMessage({ t: 'strip', track: i, l: gains.l, r: gains.r });
        });
    }

    private keepPumping(): void {
        if (this.timer) return;
        this.timer = setInterval(() => {
            const player = this.player;
            if (player?.busy()) {
                void player.pump();
            } else if (this.timer) {
                clearInterval(this.timer);
                this.timer = null;
            }
        }, PUMP_MS);
    }

    /** The linear player reached song step `pos`, sounding at context time `time`. */
    onSongStep(arrangement: Arrangement, pos: number, time: number, absStep: number, tempo: number): void {
        const context = this.context;
        if (!context) return;
        if (!hasAudioClips(arrangement)) {
            if (this.player?.busy()) this.player.stopAll(Math.round(time * context.sampleRate));
            return;
        }
        if (!this.player) {
            void this.ensure();
            return;
        }
        this.player.step({
            arrangement,
            pos,
            frame: Math.round(time * context.sampleRate),
            absStep,
            clock: { tempo, swing: swingPercentToClock(transportMixStore.meterRef.current.swing) },
            loopLength: arrangementEnd(arrangement),
        });
        if (this.player.busy()) this.keepPumping();
    }

    /** The transport plays a pattern or the session: audio clips stop at `time`. */
    offSong(time: number): void {
        const context = this.context;
        if (context && this.player?.busy()) this.player.stopAll(Math.round(time * context.sampleRate));
    }

    stopAll(): void {
        this.player?.stopAll();
    }
}

export const audioClipHost = new AudioClipHost();
