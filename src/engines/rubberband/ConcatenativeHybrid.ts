/**
 * ConcatenativeHybrid - sustain long sung notes from a recorded vowel loop.
 *
 * Part of RUBBERBAND_ENHANCEMENT_PLAN Section 8 / VOCAL_WORKSTATION_PLAN V2.
 *
 * Short notes stay TTS. On a bank with `useVowelSamplesOnLongNotes`, a note of
 * at least `minNoteDurationMs` crossfades from the TTS voice into the vowel
 * sample nearest its pitch, inside the note's sustained vowel. This module is
 * the TypeScript half of the language split:
 *
 * - it owns the manifest (`public/assets/vowels/manifest.json`), the duration
 *   gate, which vowel and which sample, how many loop repeats, and the
 *   crossfade curve;
 * - Rubber Band (`rubberband.wasm`, the same RubberBandProcessor worklet the
 *   TTS voice runs in) pitch-shifts the loop to the note with formants
 *   preserved and stretches it to fill the rest of the note.
 *
 * Nothing here touches an AudioContext, so the live trigger and the offline
 * vocal host (src/audio/offline/vocal/) make the same plan for the same note.
 *
 * @see RUBBERBAND_ENHANCEMENT_PLAN.md Section 8
 */

import type { AlignmentResult } from './alignment/types';
import { fetchPublicArrayBuffer, fetchPublicJson } from '../../utils/publicAsset';

/** Vowel types for sample library */
export type VowelType = 'ah' | 'ee' | 'eh' | 'oh' | 'oo' | 'ih' | 'uh';

export const VOWEL_TYPES: readonly VowelType[] = ['ah', 'ee', 'eh', 'oh', 'oo', 'ih', 'uh'];

/** Sample entry in the vowel library */
export interface VowelSample {
    /** Vowel type identifier */
    vowel: VowelType;
    /** Pitch the sample was recorded at (fractional MIDI) */
    midiNote: number;
    /** Mono audio data */
    audio: Float32Array;
    /** Sample rate of `audio` */
    sampleRate: number;
    /** Loop region start (in samples) */
    loopStart: number;
    /** Loop region end, exclusive (in samples) */
    loopEnd: number;
}

/** One entry of `manifest.json`. */
export interface VowelManifestEntry {
    vowel: VowelType;
    /** WAV file name, relative to the manifest. */
    file: string;
    midiNote: number;
    /** Loop points in samples at the manifest's `sampleRate`. */
    loopStart: number;
    loopEnd: number;
}

export interface VowelManifest {
    version: 1;
    sampleRate: number;
    samples: VowelManifestEntry[];
}

/** Crossfade configuration */
export interface CrossfadeConfig {
    /** Duration of crossfade in milliseconds */
    durationMs: number;
    /** Type of crossfade curve */
    curve: 'linear' | 'cosine' | 'exponential';
}

/** Configuration for concatenative hybrid system */
export interface ConcatenativeConfig {
    /** Crossfade settings */
    crossfade: CrossfadeConfig;
    /** Minimum note duration (ms) to use real samples */
    minNoteDurationMs: number;
    /**
     * Rate the plan is made at: the AudioContext's (live) or the export rate
     * (offline). Library samples must already be at this rate.
     */
    sampleRate: number;
}

/** Defaults. `sampleRate` is not one: it always comes from the context. */
export const DEFAULT_CONCATENATIVE_CONFIG: Omit<ConcatenativeConfig, 'sampleRate'> = {
    crossfade: {
        durationMs: 50,
        curve: 'cosine'
    },
    minNoteDurationMs: 500,
};

/** Where the built-in pack lives under `public/`. */
export const DEFAULT_VOWEL_PACK_PATH = 'assets/vowels/';

/** Stretch ratio cap for the loop; the worklet clamps its time ratio to 4. */
const MAX_LOOP_TIME_RATIO = 2;

export type VowelLibraryStatus =
    | { state: 'empty' }
    | { state: 'ready'; count: number }
    | { state: 'disabled'; reason: string };

/** Decodes a WAV to mono at the caller's rate (live: `AudioContext.decodeAudioData`). */
export type DecodeVowelAudio = (bytes: ArrayBuffer) => Promise<{ data: Float32Array; sampleRate: number }>;

/** Converts mono audio between rates (offline: the shared OfflineAudioContext resampler). */
export type ResampleVowelAudio = (data: Float32Array, fromRate: number, toRate: number) => Promise<Float32Array>;

function isVowelType(value: unknown): value is VowelType {
    return typeof value === 'string' && (VOWEL_TYPES as readonly string[]).includes(value);
}

/** Validate a parsed `manifest.json`; throws with the first problem found. */
export function parseVowelManifest(json: unknown): VowelManifest {
    const m = json as Partial<VowelManifest> | null;
    if (!m || typeof m !== 'object') throw new Error('manifest is not an object');
    if (m.version !== 1) throw new Error(`unsupported manifest version ${String(m.version)}`);
    if (typeof m.sampleRate !== 'number' || !(m.sampleRate > 0)) throw new Error('manifest sampleRate is missing');
    if (!Array.isArray(m.samples) || m.samples.length === 0) throw new Error('manifest lists no samples');
    m.samples.forEach((s, i) => {
        if (!isVowelType(s?.vowel)) throw new Error(`sample ${i}: unknown vowel ${String(s?.vowel)}`);
        if (typeof s.file !== 'string' || s.file.length === 0) throw new Error(`sample ${i}: file is missing`);
        if (typeof s.midiNote !== 'number' || !Number.isFinite(s.midiNote)) throw new Error(`sample ${i}: midiNote is missing`);
        if (!(Number.isInteger(s.loopStart) && Number.isInteger(s.loopEnd) && s.loopStart >= 0 && s.loopEnd > s.loopStart)) {
            throw new Error(`sample ${i}: loop points are invalid`);
        }
    });
    return m as VowelManifest;
}

/**
 * VowelLibrary - the decoded vowel pack.
 *
 * A failed load leaves the library `disabled` with a reason; banks that asked
 * for vowel samples then stay on TTS and the Engine HUD shows the reason.
 */
export class VowelLibrary {
    private samples: Map<VowelType, VowelSample[]> = new Map();
    private status: VowelLibraryStatus = { state: 'empty' };

    /**
     * Load a vowel sample into the library.
     *
     * @param sample Vowel sample to add
     */
    addSample(sample: VowelSample): void {
        const key = sample.vowel;
        if (!this.samples.has(key)) {
            this.samples.set(key, []);
        }
        this.samples.get(key)!.push(sample);
        this.status = { state: 'ready', count: this.size() };
    }

    /**
     * Get the best matching sample for a vowel and pitch.
     *
     * @param vowel Vowel type
     * @param midiNote Target MIDI note
     * @returns Best matching sample or null
     */
    getSample(vowel: VowelType, midiNote: number): VowelSample | null {
        const vowelSamples = this.samples.get(vowel);
        if (!vowelSamples || vowelSamples.length === 0) {
            return null;
        }

        // Find closest pitch match
        let bestMatch = vowelSamples[0];
        let minDistance = Math.abs(bestMatch.midiNote - midiNote);

        for (const sample of vowelSamples) {
            const distance = Math.abs(sample.midiNote - midiNote);
            if (distance < minDistance) {
                minDistance = distance;
                bestMatch = sample;
            }
        }

        return bestMatch;
    }

    /**
     * Fetch `<basePath>manifest.json` and every WAV it lists (under `public/`,
     * through `resolvePublicAsset`). Never throws: a missing or malformed pack
     * returns — and keeps — a `disabled` status with the reason.
     *
     * @param basePath Directory under `public/`, e.g. `assets/vowels/`
     * @param decode Decoder at the rate the samples will play at
     */
    async loadFromUrl(basePath: string, decode: DecodeVowelAudio): Promise<VowelLibraryStatus> {
        const base = basePath.endsWith('/') ? basePath : `${basePath}/`;
        this.clear();
        try {
            const manifest = parseVowelManifest(await fetchPublicJson<unknown>(`${base}manifest.json`));
            const decoded = await Promise.all(manifest.samples.map(async (entry) => {
                const { data, sampleRate } = await decode(await fetchPublicArrayBuffer(`${base}${entry.file}`));
                const scale = sampleRate / manifest.sampleRate;
                return {
                    vowel: entry.vowel,
                    midiNote: entry.midiNote,
                    audio: data,
                    sampleRate,
                    loopStart: Math.round(entry.loopStart * scale),
                    loopEnd: Math.min(data.length, Math.round(entry.loopEnd * scale)),
                } satisfies VowelSample;
            }));
            for (const sample of decoded) this.addSample(sample);
        } catch (e) {
            this.clear();
            this.status = { state: 'disabled', reason: `vowel pack unavailable: ${e instanceof Error ? e.message : String(e)}` };
        }
        return this.status;
    }

    /**
     * The same pack at `sampleRate`, for a render at another rate (export).
     * Loop points are scaled; returns `this` when the rate already matches.
     */
    async withSampleRate(sampleRate: number, resample: ResampleVowelAudio): Promise<VowelLibrary> {
        const all = this.allSamples();
        if (all.every((s) => s.sampleRate === sampleRate)) return this;
        const next = new VowelLibrary();
        next.status = this.status;
        for (const s of all) {
            const audio = s.sampleRate === sampleRate ? s.audio : await resample(s.audio, s.sampleRate, sampleRate);
            const scale = sampleRate / s.sampleRate;
            next.addSample({
                ...s,
                audio,
                sampleRate,
                loopStart: Math.round(s.loopStart * scale),
                loopEnd: Math.min(audio.length, Math.round(s.loopEnd * scale)),
            });
        }
        return next;
    }

    getStatus(): VowelLibraryStatus {
        return this.status;
    }

    /**
     * Get all available vowels in the library.
     */
    getAvailableVowels(): VowelType[] {
        return Array.from(this.samples.keys());
    }

    size(): number {
        let n = 0;
        for (const list of this.samples.values()) n += list.length;
        return n;
    }

    /**
     * Clear all samples from the library.
     */
    clear(): void {
        this.samples.clear();
        this.status = { state: 'empty' };
    }

    private allSamples(): VowelSample[] {
        return Array.from(this.samples.values()).flat();
    }
}

/** ARPABET (stress digits ignored) and plain vowel names to the pack's vowels. */
const PHONEME_TO_VOWEL: Record<string, VowelType> = {
    AA: 'ah', AY: 'ah', AW: 'ah',
    AE: 'eh', EH: 'eh', EY: 'eh',
    AH: 'uh', ER: 'uh',
    AO: 'oh', OW: 'oh', OY: 'oh',
    UH: 'oo', UW: 'oo',
    IH: 'ih',
    IY: 'ee',
};

/** The pack vowel a phoneme sustains on, or null for a consonant. */
export function vowelForPhoneme(phoneme: string): VowelType | null {
    const lower = phoneme.toLowerCase();
    if (isVowelType(lower)) return lower;
    return PHONEME_TO_VOWEL[phoneme.toUpperCase().replace(/[0-9]/g, '')] ?? null;
}

/**
 * The vowel a sung phrase holds: the last vowel of the alignment (the one a
 * long note stretches), with where it starts as a fraction of the phrase.
 * Without an alignment the phrase is treated as an open `ah` from the start.
 */
export function sustainedVowel(alignment: AlignmentResult | null | undefined): { vowel: VowelType; onset: number } {
    const phonemes = alignment?.phonemes ?? [];
    const duration = alignment?.duration ?? 0;
    for (let i = phonemes.length - 1; i >= 0; i--) {
        const vowel = vowelForPhoneme(phonemes[i].phoneme);
        if (vowel) {
            const onset = duration > 0 ? Math.min(1, Math.max(0, phonemes[i].start / duration)) : 0;
            return { vowel, onset };
        }
    }
    return { vowel: 'ah', onset: 0 };
}

/** Gain curve for a crossfade of `steps` points, rising (`in`) or falling (`out`). */
export function crossfadeCurve(curve: CrossfadeConfig['curve'], steps: number, direction: 'in' | 'out'): Float32Array {
    const n = Math.max(2, Math.floor(steps));
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
        const x = i / (n - 1);
        let mix: number;
        switch (curve) {
            case 'cosine':
                mix = 0.5 * (1 - Math.cos(Math.PI * x));
                break;
            case 'exponential':
                mix = x * x;
                break;
            default:
                mix = x;
        }
        out[i] = direction === 'in' ? mix : 1 - mix;
    }
    return out;
}

/** What the trigger needs to add a vowel layer to one note. */
export interface VowelLayerPlan {
    sample: VowelSample;
    /** Seconds after note start where the TTS fades out and the vowel fades in. */
    crossfadeStart: number;
    crossfadeDuration: number;
    curve: CrossfadeConfig['curve'];
    /** The loop, repeated: the buffer the vowel voice plays (at `sampleRate`). */
    buffer: Float32Array;
    /** Stable id of `buffer`, so a voice that already holds it is not reloaded. */
    bufferKey: string;
    /**
     * Seconds the vowel voice plays: the whole note. The worklet starts a note
     * when its message arrives, not at a scheduled time, so the layer cannot be
     * deferred to the crossfade; it runs from note start under a gain of 0.
     */
    playDuration: number;
    /** Rubber Band time ratio: playDuration / buffer duration, at most 2. */
    timeRatio: number;
    /** Pitch of the sample, for the voice's pitch ratio. */
    rootMidi: number;
}

export interface PlanNoteInput {
    /** Note length in seconds (after retrigger split). */
    durationSec: number;
    /** Sequenced pitch, fractional MIDI. */
    midiNote: number;
    /** The bank's phoneme alignment, if any. */
    alignment?: AlignmentResult | null;
    /** Per-bank gate; defaults to the config's `minNoteDurationMs`. */
    minNoteDurationMs?: number;
}

/**
 * ConcatenativeHybrid - decides, per note, whether and how a vowel loop takes
 * over from TTS. Construct one per context rate.
 */
export class ConcatenativeHybrid {
    private config: ConcatenativeConfig;
    private vowelLibrary: VowelLibrary;
    private readonly tiled = new WeakMap<VowelSample, Map<number, Float32Array>>();

    constructor(config: Partial<Omit<ConcatenativeConfig, 'sampleRate'>> & Pick<ConcatenativeConfig, 'sampleRate'>, library: VowelLibrary = new VowelLibrary()) {
        this.config = { ...DEFAULT_CONCATENATIVE_CONFIG, ...config };
        this.vowelLibrary = library;
    }

    /**
     * Get the vowel library for adding samples.
     */
    getLibrary(): VowelLibrary {
        return this.vowelLibrary;
    }

    getConfig(): Readonly<ConcatenativeConfig> {
        return this.config;
    }

    /**
     * The duration gate: true when a note this long holding this phoneme is
     * sustained from a sample. Shorter notes stay TTS.
     *
     * @param durationMs Note duration in milliseconds
     * @param phoneme Phoneme held by the note (ARPABET or a pack vowel name)
     */
    shouldUseRealSample(durationMs: number, phoneme: string): boolean {
        return vowelForPhoneme(phoneme) !== null && durationMs >= this.config.minNoteDurationMs;
    }

    /**
     * Plan the vowel layer for a note, or null when it stays TTS: too short, no
     * sample for its vowel, or no room left for the crossfade.
     */
    planNote(input: PlanNoteInput): VowelLayerPlan | null {
        const { vowel, onset } = sustainedVowel(input.alignment);
        const gateMs = input.minNoteDurationMs ?? this.config.minNoteDurationMs;
        if (input.durationSec * 1000 < gateMs) return null;
        const sample = this.vowelLibrary.getSample(vowel, input.midiNote);
        if (!sample) return null;
        if (sample.sampleRate !== this.config.sampleRate) {
            throw new Error(
                `vowel sample is at ${sample.sampleRate} Hz but the plan is at ${this.config.sampleRate} Hz; ` +
                'resample the library (VowelLibrary.withSampleRate) for this context',
            );
        }

        const fade = this.config.crossfade.durationMs / 1000;
        // Let the TTS vowel speak for one crossfade length after its onset
        // (uniform-stretch estimate: the vowel absorbs most of the stretch, so
        // the real onset is earlier and this lands inside it), and finish the
        // crossfade one length before the note ends.
        const latest = input.durationSec - 2 * fade;
        if (latest <= 0) return null;
        const crossfadeStart = Math.min(onset * input.durationSec + fade, latest);
        const playDuration = input.durationSec;

        const loopLength = sample.loopEnd - sample.loopStart;
        const loopSeconds = loopLength / sample.sampleRate;
        const repeats = Math.max(1, Math.ceil(playDuration / (loopSeconds * MAX_LOOP_TIME_RATIO)));
        const buffer = this.tiledLoop(sample, repeats);
        const timeRatio = playDuration / (buffer.length / sample.sampleRate);

        return {
            sample,
            crossfadeStart,
            crossfadeDuration: fade,
            curve: this.config.crossfade.curve,
            buffer,
            bufferKey: `vowel:${sample.vowel}:${sample.midiNote}:${sample.sampleRate}:x${repeats}`,
            playDuration,
            timeRatio,
            rootMidi: sample.midiNote,
        };
    }

    /**
     * Mix two signals with this config's crossfade at the start: `from` fades
     * out while `to` fades in over `crossfade.durationMs`, then `to` alone.
     */
    generateCrossfade(from: Float32Array, to: Float32Array): Float32Array {
        const fadeSamples = Math.max(1, Math.floor(this.config.crossfade.durationMs * this.config.sampleRate / 1000));
        const fadeIn = crossfadeCurve(this.config.crossfade.curve, fadeSamples + 1, 'in');
        const outputLength = Math.max(from.length, to.length);
        const output = new Float32Array(outputLength);
        for (let i = 0; i < outputLength; i++) {
            const fromSample = i < from.length ? from[i] : 0;
            const toSample = i < to.length ? to[i] : 0;
            const mix = i < fadeSamples ? fadeIn[i] : 1;
            output[i] = fromSample * (1 - mix) + toSample * mix;
        }
        return output;
    }

    /** The loop region repeated `repeats` times; cached per sample. */
    private tiledLoop(sample: VowelSample, repeats: number): Float32Array {
        let bySample = this.tiled.get(sample);
        if (!bySample) {
            bySample = new Map();
            this.tiled.set(sample, bySample);
        }
        const cached = bySample.get(repeats);
        if (cached) return cached;
        const loop = sample.audio.subarray(sample.loopStart, sample.loopEnd);
        const out = new Float32Array(loop.length * repeats);
        for (let r = 0; r < repeats; r++) out.set(loop, r * loop.length);
        bySample.set(repeats, out);
        return out;
    }
}
