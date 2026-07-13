import { useCallback, useRef, useState } from 'react'
import {
    DEFAULT_SYNTH_PARAMS_A,
    DEFAULT_SYNTH_PARAMS_B,
    DEFAULT_BASS2_PARAMS,
    DEFAULT_KICK_PARAMS,
    DEFAULT_SNARE_PARAMS,
    DEFAULT_CLOSED_HAT_PARAMS,
    DEFAULT_OPEN_HAT_PARAMS,
    DEFAULT_DRUM_KIT,
    getKitDrumParams,
} from '../../constants'
import type { SynthParams, KickParams, SnareParams, SamplerParams, Bass2Params, DrumKitType } from '../../types'
import { INITIAL_SAMPLER_PARAMS } from '../../constants/appDefaults'

export function useInstrumentState(drumKitEngineRef: React.MutableRefObject<any>) {
    const [synthA, setSynthA] = useState<SynthParams>(DEFAULT_SYNTH_PARAMS_A);
    const synthARef = useRef<SynthParams>(DEFAULT_SYNTH_PARAMS_A);
    const updateSynthA = useCallback((updates: Partial<SynthParams>) => {
        setSynthA(prev => { const n = { ...prev, ...updates }; synthARef.current = n; return n; });
    }, []);

    const [synthB, setSynthB] = useState<SynthParams>(DEFAULT_SYNTH_PARAMS_B);
    const synthBRef = useRef<SynthParams>(DEFAULT_SYNTH_PARAMS_B);
    const updateSynthB = useCallback((updates: Partial<SynthParams>) => {
        setSynthB(prev => { const n = { ...prev, ...updates }; synthBRef.current = n; return n; });
    }, []);

    const [bass2, setBass2] = useState<Bass2Params>(DEFAULT_BASS2_PARAMS);
    const bass2Ref = useRef<Bass2Params>(DEFAULT_BASS2_PARAMS);
    const updateBass2 = useCallback((updates: Partial<Bass2Params>) => {
        setBass2(prev => { const n = { ...prev, ...updates }; bass2Ref.current = n; return n; });
    }, []);

    const [kick, setKick] = useState<KickParams>(DEFAULT_KICK_PARAMS);
    const kickRef = useRef(DEFAULT_KICK_PARAMS);
    const updateKick = useCallback((u: Partial<KickParams>) => {
        setKick(prev => { const n = { ...prev, ...u }; kickRef.current = n; return n; });
    }, []);

    const [snare, setSnare] = useState<SnareParams>(DEFAULT_SNARE_PARAMS);
    const snareRef = useRef(DEFAULT_SNARE_PARAMS);
    const updateSnare = useCallback((u: Partial<SnareParams>) => {
        setSnare(prev => { const n = { ...prev, ...u }; snareRef.current = n; return n; });
    }, []);

    const [closedHat, setClosedHat] = useState(DEFAULT_CLOSED_HAT_PARAMS);
    const closedHatRef = useRef(DEFAULT_CLOSED_HAT_PARAMS);
    const updateClosedHat = useCallback((u: Partial<typeof DEFAULT_CLOSED_HAT_PARAMS>) => {
        setClosedHat(prev => { const n = { ...prev, ...u }; closedHatRef.current = n; return n; });
    }, []);

    const [openHat, setOpenHat] = useState(DEFAULT_OPEN_HAT_PARAMS);
    const openHatRef = useRef(DEFAULT_OPEN_HAT_PARAMS);
    const updateOpenHat = useCallback((u: Partial<typeof DEFAULT_OPEN_HAT_PARAMS>) => {
        setOpenHat(prev => { const n = { ...prev, ...u }; openHatRef.current = n; return n; });
    }, []);

    const [drumKit, setDrumKit] = useState<DrumKitType>(DEFAULT_DRUM_KIT);
    const drumKitRef = useRef<DrumKitType>(DEFAULT_DRUM_KIT);
    const updateDrumKit = useCallback((kit: DrumKitType) => {
        setDrumKit(kit);
        drumKitRef.current = kit;
        if (drumKitEngineRef?.current) {
            drumKitEngineRef.current.setKit(kit);
        }
        const kitParams = getKitDrumParams(kit);
        setKick(kitParams.kick); kickRef.current = kitParams.kick;
        setSnare(kitParams.snare); snareRef.current = kitParams.snare;
        setClosedHat(kitParams.closedHat); closedHatRef.current = kitParams.closedHat;
        setOpenHat(kitParams.openHat); openHatRef.current = kitParams.openHat;
    }, [drumKitEngineRef]);

    const [sampler, setSampler] = useState<SamplerParams>(INITIAL_SAMPLER_PARAMS);
    const samplerRef = useRef(INITIAL_SAMPLER_PARAMS);
    const updateSampler = useCallback((u: SamplerParams) => { setSampler(u); samplerRef.current = u; }, []);

    return {
        synthA, setSynthA, synthARef, updateSynthA,
        synthB, setSynthB, synthBRef, updateSynthB,
        bass2, setBass2, bass2Ref, updateBass2,
        kick, setKick, kickRef, updateKick,
        snare, setSnare, snareRef, updateSnare,
        closedHat, setClosedHat, closedHatRef, updateClosedHat,
        openHat, setOpenHat, openHatRef, updateOpenHat,
        drumKit, drumKitRef, updateDrumKit,
        sampler, setSampler, samplerRef, updateSampler,
    };
}
