import { useEffect, useMemo, useRef, useState } from 'react'
import type { AlignmentResult } from '../../engines/rubberband/PhonemeAligner'
import type { PartSequence, AudioEngine } from '../../types'
import {
    UPDATED_INITIAL_PATTERN,
    type TrackKey, type SongSnapshot,
    getInitialTrackStorage,
} from '../../constants/appDefaults'

export function useSamplerBanksState(audioEngine: AudioEngine | null) {
    const [trackStorage, setTrackStorage] = useState<Record<TrackKey, (PartSequence | PartSequence[] | null)[]>>(
        getInitialTrackStorage(UPDATED_INITIAL_PATTERN)
    );
    const [activeTrackSlots, setActiveTrackSlots] = useState<Record<TrackKey, number>>({
        partA: 0, partB: 0, bass2: 0, kick: 0, snare: 0, closedHat: 0, openHat: 0, sampler: 0
    });
    const activeTrackSlotsRef = useRef(activeTrackSlots);
    useEffect(() => { activeTrackSlotsRef.current = activeTrackSlots; }, [activeTrackSlots]);
    const trackStorageRef = useRef(trackStorage);
    useEffect(() => { trackStorageRef.current = trackStorage; }, [trackStorage]);

    const [songStorage, setSongStorage] = useState<(SongSnapshot | null)[]>([null, null, null, null]);
    const [activeSongSlot, setActiveSongSlot] = useState<number | null>(null);

    const [activeAlignment, setActiveAlignment] = useState<AlignmentResult | null>(null);

    const [activeSamplerBank, setActiveSamplerBank] = useState(0);
    const activeSamplerBankRef = useRef(activeSamplerBank);

    useEffect(() => {
        activeSamplerBankRef.current = activeSamplerBank;
        if (audioEngine && audioEngine.getAlignment) {
            setActiveAlignment(audioEngine.getAlignment(activeSamplerBank));
        }
    }, [activeSamplerBank, audioEngine]);

    const [sampleBuffers, setSampleBuffers] = useState<(AudioBuffer | null)[]>(new Array(8).fill(null));
    const loadedBanks = useMemo(() => sampleBuffers.map(b => !!b), [sampleBuffers]);

    const multisampleReady = useMemo(() =>
        Array.from({ length: 8 }, (_, i) => audioEngine?.isMultisampleReady?.(i) ?? false),
        [audioEngine, sampleBuffers]
    );
    const multisampleProcessing = useMemo(() =>
        Array.from({ length: 8 }, (_, i) => {
            const bank = audioEngine?.getMultisampleBank?.(i);
            return bank?.isProcessing ?? false;
        }),
        [audioEngine, sampleBuffers]
    );
    const [ttsPhrases, setTtsPhrases] = useState<string[]>(Array(8).fill("Hello World"));

    const lastSamplerMidiRef = useRef<Record<number, number>>({});
    const lastSamplerFormantRef = useRef<Record<number, number>>({});
    const sliceHighlightRef = useRef<((slice: number) => void) | null>(null);

    return {
        trackStorage, setTrackStorage, trackStorageRef,
        activeTrackSlots, setActiveTrackSlots, activeTrackSlotsRef,
        songStorage, setSongStorage,
        activeSongSlot, setActiveSongSlot,
        activeSamplerBank, setActiveSamplerBank, activeSamplerBankRef,
        activeAlignment, setActiveAlignment,
        sampleBuffers, setSampleBuffers,
        loadedBanks,
        multisampleReady,
        multisampleProcessing,
        ttsPhrases, setTtsPhrases,
        lastSamplerMidiRef,
        lastSamplerFormantRef,
        sliceHighlightRef,
    }
}
