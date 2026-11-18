// src/audio-worklets/audio-clip-processor.ts
// Audio clip player (#1629 D4): plays the arrangement's audio clips, one stereo
// output per audio track, each output cabled to that track's `audioTrackVoice`
// socket in the patch.
//
// Voices stream: the main thread's pager writes each voice's source into an SAB
// ring (crossOriginIsolated pages) or posts it in chunks (otherwise), a page
// ahead of the play position, so no clip is ever held whole in memory.
//
// Messages (AudioClipPlayer.ts): prepare (a voice gets a new clip; its feed
// fills before it sounds) → arm (the exact start frame) → end (a stop, or a
// tempo change moved the right edge). `gen` drops messages meant for a voice's
// previous clip. The
// voice DSP (envelope, declick, resampler, late-page catch-up) is shared with
// the offline render: `src/shared/rt/audioClipVoice.ts`.

import {
    AUDIO_CLIP_PROCESSOR_NAME,
    ChunkQueueFeed,
    ClipVoice,
    SabClipRing,
    ringBytes,
    type ClipFeed,
    type ClipVoiceSpec,
} from '../shared/rt/audioClipVoice';

interface Options {
    voices: number;
    tracks: number;
    capacity: number;
    sab: SharedArrayBuffer | null;
}

type Message =
    | { t: 'prepare'; v: number; gen: number }
    | { t: 'arm'; v: number; gen: number; track: number; spec: ClipVoiceSpec }
    | { t: 'end'; v: number; gen: number; endFrame: number; clipEndFrame: number }
    | { t: 'stopAll'; atFrame: number }
    | { t: 'strip'; track: number; l: number; r: number }
    | { t: 'chunk'; v: number; gen: number; l: Float32Array; r: Float32Array | null };

const BLOCK = 128;

class AudioClipProcessor extends AudioWorkletProcessor {
    private readonly voices: ClipVoice[];
    private readonly gens: Int32Array;
    private readonly feeds: ClipFeed[];
    private readonly chunkFeeds: ChunkQueueFeed[] | null;
    private readonly accL: Float32Array[];
    private readonly accR: Float32Array[];
    private readonly used: Uint8Array;
    private readonly stripL: Float32Array;
    private readonly stripR: Float32Array;
    private readonly targetL: Float32Array;
    private readonly targetR: Float32Array;
    /** Each voice's underrun frames already reported. */
    private readonly reported: Float64Array;
    private pendingUnderrun = 0;
    private lastReportFrame = -Infinity;

    constructor(options: { processorOptions?: Options }) {
        super();
        const opts = options.processorOptions ?? { voices: 1, tracks: 1, capacity: 1, sab: null };
        const voiceCount = Math.max(1, opts.voices | 0);
        const tracks = Math.max(1, opts.tracks | 0);
        this.voices = Array.from({ length: voiceCount }, () => new ClipVoice(BLOCK));
        this.gens = new Int32Array(voiceCount);
        this.reported = new Float64Array(voiceCount);
        if (opts.sab) {
            const sab = opts.sab;
            const bytes = ringBytes(opts.capacity);
            this.feeds = this.voices.map((_, v) => new SabClipRing(sab, v * bytes, opts.capacity));
            this.chunkFeeds = null;
        } else {
            this.chunkFeeds = this.voices.map(() => new ChunkQueueFeed());
            this.feeds = this.chunkFeeds;
        }
        this.accL = Array.from({ length: tracks }, () => new Float32Array(BLOCK));
        this.accR = Array.from({ length: tracks }, () => new Float32Array(BLOCK));
        this.used = new Uint8Array(tracks);
        this.stripL = new Float32Array(tracks).fill(1);
        this.stripR = new Float32Array(tracks).fill(1);
        this.targetL = new Float32Array(tracks).fill(1);
        this.targetR = new Float32Array(tracks).fill(1);
        this.port.onmessage = (e: MessageEvent<Message>) => this.onMessage(e.data);
    }

    private onMessage(msg: Message): void {
        switch (msg.t) {
            case 'prepare': {
                // A new clip for this voice: drop what is left of the last one.
                const voice = this.voices[msg.v];
                if (!voice) return;
                this.gens[msg.v] = msg.gen;
                voice.active = false;
                this.chunkFeeds?.[msg.v].clear();
                break;
            }
            case 'arm': {
                const voice = this.voices[msg.v];
                if (!voice || this.gens[msg.v] !== msg.gen) return;
                voice.start(msg.spec, msg.track);
                this.reported[msg.v] = 0;
                break;
            }
            case 'end': {
                if (this.gens[msg.v] === msg.gen) this.voices[msg.v]?.setEnd(msg.endFrame, msg.clipEndFrame);
                break;
            }
            case 'stopAll':
                for (const voice of this.voices) {
                    if (voice.active && voice.spec.endFrame > msg.atFrame) voice.setEnd(msg.atFrame, voice.spec.clipEndFrame);
                }
                break;
            case 'strip':
                if (msg.track >= 0 && msg.track < this.targetL.length) {
                    this.targetL[msg.track] = msg.l;
                    this.targetR[msg.track] = msg.r;
                }
                break;
            case 'chunk':
                if (this.chunkFeeds && this.gens[msg.v] === msg.gen) this.chunkFeeds[msg.v].push(msg.l, msg.r ?? msg.l);
                break;
        }
    }

    process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
        const frames = outputs[0]?.[0]?.length ?? BLOCK;
        const blockStart = currentFrame;
        this.used.fill(0);
        for (let v = 0; v < this.voices.length; v++) {
            const voice = this.voices[v];
            if (!voice.active) continue;
            const t = voice.track;
            if (t < 0 || t >= this.accL.length) continue;
            if (!this.used[t]) {
                this.accL[t].fill(0);
                this.accR[t].fill(0);
                this.used[t] = 1;
            }
            voice.render(this.feeds[v], this.accL[t], this.accR[t], blockStart, frames);
            if (voice.underrunFrames > this.reported[v]) {
                this.pendingUnderrun += voice.underrunFrames - this.reported[v];
                this.reported[v] = voice.underrunFrames;
            }
        }
        for (let t = 0; t < outputs.length && t < this.accL.length; t++) {
            const out = outputs[t];
            const l = out[0];
            const r = out[1] ?? out[0];
            const fromL = this.stripL[t];
            const fromR = this.stripR[t];
            const toL = this.targetL[t];
            const toR = this.targetR[t];
            if (!this.used[t]) {
                l.fill(0);
                if (r !== l) r.fill(0);
            } else {
                const accL = this.accL[t];
                const accR = this.accR[t];
                for (let i = 0; i < frames; i++) {
                    const k = (i + 1) / frames;
                    l[i] = accL[i] * (fromL + (toL - fromL) * k);
                    if (r !== l) r[i] = accR[i] * (fromR + (toR - fromR) * k);
                }
            }
            this.stripL[t] = toL;
            this.stripR[t] = toR;
        }
        // A late page is rare and worth knowing about; at most one report a second.
        if (this.pendingUnderrun > 0 && blockStart - this.lastReportFrame >= sampleRate) {
            this.port.postMessage({ t: 'underrun', frames: this.pendingUnderrun });
            this.pendingUnderrun = 0;
            this.lastReportFrame = blockStart;
        }
        return true;
    }
}

registerProcessor(AUDIO_CLIP_PROCESSOR_NAME, AudioClipProcessor);
