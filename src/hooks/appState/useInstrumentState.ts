import { useCallback, type SetStateAction } from 'react'
import { getKitDrumParams } from '../../constants'
import type { SynthParams, KickParams, SnareParams, SamplerParams, Bass2Params, DrumKitType, HatParams } from '../../types'
import { instrumentStore, mergeSynthParams, useInstrumentStore } from '../../stores/instrumentStore'

export { mergeSynthParams }

const { refs } = instrumentStore;

const setSynthA = (a: SetStateAction<SynthParams>) => instrumentStore.set('synthA', a);
const setSynthB = (a: SetStateAction<SynthParams>) => instrumentStore.set('synthB', a);
const setBass2 = (a: SetStateAction<Bass2Params>) => instrumentStore.set('bass2', a);
const setKick = (a: SetStateAction<KickParams>) => instrumentStore.set('kick', a);
const setSnare = (a: SetStateAction<SnareParams>) => instrumentStore.set('snare', a);
const setClosedHat = (a: SetStateAction<HatParams>) => instrumentStore.set('closedHat', a);
const setOpenHat = (a: SetStateAction<HatParams>) => instrumentStore.set('openHat', a);
const setSampler = (a: SetStateAction<SamplerParams>) => instrumentStore.set('sampler', a);

const updateSynthA = (updates: Partial<SynthParams>) => setSynthA((prev) => mergeSynthParams(prev, updates));
const updateSynthB = (updates: Partial<SynthParams>) => setSynthB((prev) => mergeSynthParams(prev, updates));
const updateBass2 = (updates: Partial<Bass2Params>) => setBass2((prev) => ({ ...prev, ...updates }));
const updateKick = (updates: Partial<KickParams>) => setKick((prev) => ({ ...prev, ...updates }));
const updateSnare = (updates: Partial<SnareParams>) => setSnare((prev) => ({ ...prev, ...updates }));
const updateClosedHat = (updates: Partial<HatParams>) => setClosedHat((prev) => ({ ...prev, ...updates }));
const updateOpenHat = (updates: Partial<HatParams>) => setOpenHat((prev) => ({ ...prev, ...updates }));
const updateSampler = (next: SamplerParams) => setSampler(next);

/**
 * The instrument patches (`instrumentStore`) under the field names
 * `useAppState()` has always returned. Values, setters and refs are the
 * store's; the refs are always current (no hand syncing).
 */
export function useInstrumentState(drumKitEngineRef: React.MutableRefObject<{ setKit?: (kit: DrumKitType) => void } | null>) {
    const synthA = useInstrumentStore((s) => s.params.synthA);
    const synthB = useInstrumentStore((s) => s.params.synthB);
    const bass2 = useInstrumentStore((s) => s.params.bass2);
    const kick = useInstrumentStore((s) => s.params.kick);
    const snare = useInstrumentStore((s) => s.params.snare);
    const closedHat = useInstrumentStore((s) => s.params.closedHat);
    const openHat = useInstrumentStore((s) => s.params.openHat);
    const sampler = useInstrumentStore((s) => s.params.sampler);
    const drumKit = useInstrumentStore((s) => s.drumKit);

    const updateDrumKit = useCallback((kit: DrumKitType) => {
        instrumentStore.setDrumKit(kit);
        drumKitEngineRef?.current?.setKit?.(kit);
        const kitParams = getKitDrumParams(kit);
        instrumentStore.setMany({
            kick: kitParams.kick,
            snare: kitParams.snare,
            closedHat: kitParams.closedHat,
            openHat: kitParams.openHat,
        });
    }, [drumKitEngineRef]);

    return {
        synthA, setSynthA, synthARef: refs.synthA, updateSynthA,
        synthB, setSynthB, synthBRef: refs.synthB, updateSynthB,
        bass2, setBass2, bass2Ref: refs.bass2, updateBass2,
        kick, setKick, kickRef: refs.kick, updateKick,
        snare, setSnare, snareRef: refs.snare, updateSnare,
        closedHat, setClosedHat, closedHatRef: refs.closedHat, updateClosedHat,
        openHat, setOpenHat, openHatRef: refs.openHat, updateOpenHat,
        drumKit, drumKitRef: instrumentStore.drumKitRef, updateDrumKit,
        sampler, setSampler, samplerRef: refs.sampler, updateSampler,
    };
}
