import { useMemo, useState } from 'react'
import type { AudioEngine } from '../../types'
import { samplerBanksStore, useSamplerBanksStore } from '../../stores/samplerBanksStore'

export function useSamplerBanksState(audioEngine: AudioEngine | null) {
    const trackStorage = useSamplerBanksStore(s => s.trackStorage);
    const activeTrackSlots = useSamplerBanksStore(s => s.activeTrackSlots);
    const songStorage = useSamplerBanksStore(s => s.songStorage);
    const activeSongSlot = useSamplerBanksStore(s => s.activeSongSlot);
    const activeAlignment = useSamplerBanksStore(s => s.activeAlignment);
    const activeSamplerBank = useSamplerBanksStore(s => s.activeSamplerBank);
    const sampleBuffers = useSamplerBanksStore(s => s.sampleBuffers);
    const ttsPhrases = useSamplerBanksStore(s => s.ttsPhrases);

    // Refs aren't strictly reactive, but we need to return them for the shim
    const trackStorageRef = samplerBanksStore.getSnapshot().trackStorageRef;
    const activeTrackSlotsRef = samplerBanksStore.getSnapshot().activeTrackSlotsRef;
    const activeSamplerBankRef = samplerBanksStore.getSnapshot().activeSamplerBankRef;
    const lastSamplerMidiRef = samplerBanksStore.getSnapshot().lastSamplerMidiRef;
    const lastSamplerFormantRef = samplerBanksStore.getSnapshot().lastSamplerFormantRef;
    const sliceHighlightRef = samplerBanksStore.getSnapshot().sliceHighlightRef;

    const setTrackStorage = samplerBanksStore.setTrackStorage;
    const setActiveTrackSlots = samplerBanksStore.setActiveTrackSlots;
    const setSongStorage = samplerBanksStore.setSongStorage;
    const setActiveSongSlot = samplerBanksStore.setActiveSongSlot;
    const setActiveAlignment = samplerBanksStore.setActiveAlignment;
    const setActiveSamplerBank = samplerBanksStore.setActiveSamplerBank;
    const setSampleBuffers = samplerBanksStore.setSampleBuffers;
    const setTtsPhrases = samplerBanksStore.setTtsPhrases;

    // Mimic the previous behavior of syncing alignment from engine on bank change
    const [alignmentBank, setAlignmentBank] = useState(activeSamplerBank);
    if (alignmentBank !== activeSamplerBank) {
        setAlignmentBank(activeSamplerBank);
        if (audioEngine && audioEngine.getAlignment) {
            setActiveAlignment(audioEngine.getAlignment(activeSamplerBank));
        }
    }

    // Derived state
    const loadedBanks = useMemo(() => sampleBuffers.map(b => !!b), [sampleBuffers]);

    const multisampleReady = useMemo(() =>
        sampleBuffers.map((_, i) => audioEngine?.isMultisampleReady?.(i) ?? false),
        [audioEngine, sampleBuffers]
    );
    const multisampleProcessing = useMemo(() =>
        sampleBuffers.map((_, i) => {
            const bank = audioEngine?.getMultisampleBank?.(i);
            return bank?.isProcessing ?? false;
        }),
        [audioEngine, sampleBuffers]
    );

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
