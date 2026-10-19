/**
 * Note FX chain (#1345 Phase 2): per-track, non-destructive note generators.
 *
 * A chain turns a track's steps into a list of note events. It never edits
 * the pattern; "Freeze FX to pattern" is the explicit, undoable way to write
 * its output back into steps. The same pure functions run live (the step
 * handler) and offline (stem export / freeze), so both hear the same notes.
 */
import type { TrackKey } from '@/types';

/** One generated note, in the track's own steps (fractional). */
export interface FxNoteEvent {
    /** Start, in steps from the start of the track's loop. */
    start: number;
    /** Duration in steps. */
    length: number;
    /** MIDI pitch 0–127. */
    pitch: number;
    /** 0–1. */
    velocity: number;
    /** Step whose note produced this event; its per-step params pass through. */
    sourceStep: number;
    /** Glide into this note (only the first note generated from a slid step). */
    slide: boolean;
}

export type ArpMode = 'up' | 'down' | 'updown' | 'random' | 'played';

export const ARP_MODES: readonly ArpMode[] = ['up', 'down', 'updown', 'random', 'played'];

/** Arp rates in steps per arp note: 1/64, 1/32, 1/16, 1/8, 1/4. */
export const ARP_RATES: readonly number[] = [0.25, 0.5, 1, 2, 4];

export interface ChordFxParams {
    enabled: boolean;
    /** Semitones added above every note (e.g. [4, 7] = major triad). */
    intervals: number[];
}

export interface ArpFxParams {
    enabled: boolean;
    mode: ArpMode;
    /** Steps per arp note (one of ARP_RATES). */
    rate: number;
    /** Octave range 1–4. */
    octaves: number;
    /** Note length as a fraction of the rate, 0.05–1. */
    gate: number;
}

export interface RatchetFxParams {
    enabled: boolean;
    /** Repeats per note, 1–8 (1 = off). */
    count: number;
    /** Velocity multiplier per repeat, 0–1 (1 = no decay). */
    decay: number;
    /** Repeat length as a fraction of its slot, 0.05–1. */
    gate: number;
}

export interface EuclidFxParams {
    enabled: boolean;
    /** Pulses (hits) per cycle. */
    pulses: number;
    /** Cycle length in steps, 1–32. */
    steps: number;
    /** Rotate the pattern right by this many steps. */
    rotation: number;
}

export interface HumanizeFxParams {
    enabled: boolean;
    /** Max timing offset in steps, 0–0.5. */
    timing: number;
    /** Max velocity offset, 0–1. */
    velocity: number;
}

export interface NoteFxChain {
    chord: ChordFxParams;
    arp: ArpFxParams;
    ratchet: RatchetFxParams;
    euclid: EuclidFxParams;
    humanize: HumanizeFxParams;
    /** Seed for the arp's random mode, humanize and probability. */
    seed: number;
}

export type NoteFxModuleId = 'chord' | 'arp' | 'ratchet' | 'euclid' | 'humanize';

/** Processing order: chords feed the arp, the arp feeds the ratchet, the gate and humanize come last. */
export const NOTE_FX_ORDER: readonly NoteFxModuleId[] = ['chord', 'arp', 'ratchet', 'euclid', 'humanize'];

/** Tracks with pitched notes. The sampler chain applies to every bank. */
export type NoteFxTrack = Extract<TrackKey, 'partA' | 'partB' | 'bass2' | 'sampler'>;

export const NOTE_FX_TRACKS: readonly NoteFxTrack[] = ['partA', 'partB', 'bass2', 'sampler'];

/** Song payload: absent tracks have no chain. */
export type SongNoteFx = Partial<Record<NoteFxTrack, NoteFxChain>>;

export function defaultNoteFxChain(seed = 1): NoteFxChain {
    return {
        chord: { enabled: false, intervals: [4, 7] },
        arp: { enabled: false, mode: 'up', rate: 1, octaves: 1, gate: 0.8 },
        ratchet: { enabled: false, count: 2, decay: 1, gate: 0.9 },
        euclid: { enabled: false, pulses: 5, steps: 8, rotation: 0 },
        humanize: { enabled: false, timing: 0.08, velocity: 0.15 },
        seed,
    };
}

export function isNoteFxTrack(key: TrackKey): key is NoteFxTrack {
    return (NOTE_FX_TRACKS as readonly TrackKey[]).includes(key);
}

/** True when any module of the chain would change the notes. */
export function chainIsActive(chain: NoteFxChain | null | undefined): chain is NoteFxChain {
    if (!chain) return false;
    return (
        (chain.chord.enabled && chain.chord.intervals.some((i) => i !== 0)) ||
        chain.arp.enabled ||
        (chain.ratchet.enabled && chain.ratchet.count > 1) ||
        chain.euclid.enabled ||
        (chain.humanize.enabled && (chain.humanize.timing > 0 || chain.humanize.velocity > 0))
    );
}
