/**
 * Instrument patches (#1597 P2): the knobs of the two synths, bass 2, the four
 * drums and the sampler banks — `SavedSongData.params`.
 *
 * Used to be eight `useState`s in `useInstrumentState`, each with a ref the
 * caller had to keep in sync by hand. Here a write updates the value and its
 * ref together, synchronously, and `getParams()` is one object whose identity
 * changes only when an instrument does: the project doc binding writes it as
 * the `params` field.
 */

import { useSyncExternalStore, type SetStateAction } from 'react';
import {
    DEFAULT_SYNTH_PARAMS_A,
    DEFAULT_SYNTH_PARAMS_B,
    DEFAULT_BASS2_PARAMS,
    DEFAULT_KICK_PARAMS,
    DEFAULT_SNARE_PARAMS,
    DEFAULT_CLOSED_HAT_PARAMS,
    DEFAULT_OPEN_HAT_PARAMS,
    DEFAULT_DRUM_KIT,
} from '../constants';
import { INITIAL_SAMPLER_PARAMS } from '../constants/appDefaults';
import type { Bass2Params, DrumKitType, HatParams, KickParams, SamplerParams, SnareParams, SynthParams } from '../types';

export interface InstrumentParams {
    synthA: SynthParams;
    synthB: SynthParams;
    bass2: Bass2Params;
    kick: KickParams;
    snare: SnareParams;
    closedHat: HatParams;
    openHat: HatParams;
    sampler: SamplerParams;
}

export type InstrumentKey = keyof InstrumentParams;

export const INSTRUMENT_KEYS: readonly InstrumentKey[] = [
    'synthA', 'synthB', 'bass2', 'kick', 'snare', 'closedHat', 'openHat', 'sampler',
];

export interface InstrumentState {
    /** Key order is `SavedSongData.params`' order. */
    params: InstrumentParams;
    drumKit: DrumKitType;
}

type Refs = { [K in InstrumentKey]: { current: InstrumentParams[K] } };

function defaults(): InstrumentParams {
    return {
        synthA: DEFAULT_SYNTH_PARAMS_A,
        synthB: DEFAULT_SYNTH_PARAMS_B,
        bass2: DEFAULT_BASS2_PARAMS,
        kick: DEFAULT_KICK_PARAMS,
        snare: DEFAULT_SNARE_PARAMS,
        closedHat: DEFAULT_CLOSED_HAT_PARAMS,
        openHat: DEFAULT_OPEN_HAT_PARAMS,
        sampler: INITIAL_SAMPLER_PARAMS,
    };
}

/**
 * Shallow merge, except `macro`, which merges field by field: a macro knob
 * updates one field without restating the rest of the block.
 */
export function mergeSynthParams(prev: SynthParams, updates: Partial<SynthParams>): SynthParams {
    const next = { ...prev, ...updates };
    if (updates.macro) next.macro = { ...prev.macro, ...updates.macro };
    return next;
}

class InstrumentStore {
    private state: InstrumentState = { params: defaults(), drumKit: DEFAULT_DRUM_KIT };
    private readonly listeners = new Set<() => void>();
    /** Read on the audio path without a render; always equal to the store. */
    readonly refs: Refs = Object.fromEntries(
        INSTRUMENT_KEYS.map((key) => [key, { current: this.state.params[key] }]),
    ) as Refs;
    readonly drumKitRef: { current: DrumKitType } = { current: DEFAULT_DRUM_KIT };

    subscribe = (listener: () => void): (() => void) => {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    };

    getSnapshot = (): InstrumentState => this.state;

    getParams = (): InstrumentParams => this.state.params;

    set = <K extends InstrumentKey>(key: K, action: SetStateAction<InstrumentParams[K]>): void => {
        const prev = this.state.params[key];
        const next = typeof action === 'function'
            ? (action as (p: InstrumentParams[K]) => InstrumentParams[K])(prev)
            : action;
        this.refs[key].current = next;
        if (next === prev) return;
        this.state = { ...this.state, params: { ...this.state.params, [key]: next } };
        this.notify();
    };

    /** Several instruments at once, one notification (a load, a kit change, a doc projection). */
    setMany = (next: Partial<InstrumentParams>): void => {
        let params = this.state.params;
        for (const key of INSTRUMENT_KEYS) {
            const value = next[key];
            if (value === undefined) continue;
            (this.refs[key] as { current: unknown }).current = value;
            if (value !== params[key]) params = { ...params, [key]: value };
        }
        if (params === this.state.params) return;
        this.state = { ...this.state, params };
        this.notify();
    };

    setDrumKit = (kit: DrumKitType): void => {
        this.drumKitRef.current = kit;
        if (kit === this.state.drumKit) return;
        this.state = { ...this.state, drumKit: kit };
        this.notify();
    };

    reset = (): void => {
        this.setMany(defaults());
        this.setDrumKit(DEFAULT_DRUM_KIT);
    };

    private notify(): void {
        this.listeners.forEach((listener) => listener());
    }
}

export const instrumentStore = new InstrumentStore();

export function useInstrumentStore<T>(selector: (state: InstrumentState) => T): T {
    return useSyncExternalStore(instrumentStore.subscribe, () => selector(instrumentStore.getSnapshot()));
}
