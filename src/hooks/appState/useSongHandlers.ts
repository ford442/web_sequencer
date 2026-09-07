import { useCallback } from 'react'
import { exportSongToXM } from '../../utils/xmExport'
import type { AudioEngine, Pattern, PartSequence, SynthParams, KickParams, SnareParams, HatParams, SamplerParams } from '../../types'
import type { TrackKey, SongSnapshot } from '../../constants/appDefaults'
import type { AlignmentResult } from '../../engines/rubberband/PhonemeAligner'
import type { PyodideLike } from '../../utils/pyodideBuffers'

export function useSongHandlers(deps: {
    songStructure: ({ [key in TrackKey]: number | null })[];
    setSongStructure: React.Dispatch<React.SetStateAction<({ [key in TrackKey]: number | null })[]>>;
    setIsSongModeOpen: React.Dispatch<React.SetStateAction<boolean>>;
    patternRef: React.MutableRefObject<Pattern>;
    songStructureRef: React.MutableRefObject<({ [key in TrackKey]: number | null })[]>;
    trackStorageRef: React.MutableRefObject<Record<TrackKey, (PartSequence | PartSequence[] | null)[]>>;
    tempoRef: React.MutableRefObject<number>;
    synthARef: React.MutableRefObject<SynthParams>;
    synthBRef: React.MutableRefObject<SynthParams>;
    kickRef: React.MutableRefObject<KickParams>;
    snareRef: React.MutableRefObject<SnareParams>;
    closedHatRef: React.MutableRefObject<HatParams>;
    openHatRef: React.MutableRefObject<HatParams>;
    samplerRef: React.MutableRefObject<SamplerParams>;
    audioEngine: AudioEngine | null;
    pyodide: PyodideLike | null;
    sampleBuffers: (AudioBuffer | null)[];
}) {
    const {
        songStructure, setSongStructure, setIsSongModeOpen,
        patternRef, songStructureRef, trackStorageRef, tempoRef,
        synthARef, synthBRef, kickRef, snareRef, closedHatRef, openHatRef, samplerRef,
        audioEngine, pyodide, sampleBuffers,
    } = deps;

    const handleSongModeToggle = useCallback(() => setIsSongModeOpen(prev => !prev), [setIsSongModeOpen]);

    const handleSongStructureUpdate = useCallback((idx: number, key: TrackKey, val: number | null) => {
        setSongStructure(prev => {
            const copy = [...prev];
            copy[idx] = { ...copy[idx], [key]: val };
            return copy;
        });
    }, [setSongStructure]);

    const handleAddMeasure = useCallback(() => {
        setSongStructure(prev => [...prev, {
            partA: null, partB: null, bass2: null, kick: null, snare: null,
            closedHat: null, openHat: null, sampler: null,
        }]);
    }, [setSongStructure]);

    const handleRemoveMeasure = useCallback(() => {
        const currentStructure = songStructure;
        if (currentStructure.length === 0) return;
        const last = currentStructure[currentStructure.length - 1];
        const hasData = Object.values(last).some(v => v !== null);
        if (hasData) {
            if (!window.confirm("The last measure contains patterns. Are you sure you want to remove it?")) return;
        }
        setSongStructure(prev => prev.slice(0, -1));
    }, [songStructure, setSongStructure]);

    const handleExportXM = useCallback(() => {
        void exportSongToXM(
            songStructureRef.current,
            trackStorageRef.current,
            {
                synthA: synthARef.current,
                synthB: synthBRef.current,
                kick: kickRef.current,
                snare: snareRef.current,
                closedHat: closedHatRef.current,
                openHat: openHatRef.current,
                sampler: samplerRef.current,
            },
            tempoRef.current,
            patternRef.current,
            { webGpuEngine: audioEngine?.webGpuEngine, wasmEngine: audioEngine?.wasmEngine, pyodide },
            sampleBuffers,
        );
    }, [audioEngine, pyodide, sampleBuffers, songStructureRef, trackStorageRef, tempoRef, patternRef, synthARef, synthBRef, kickRef, snareRef, closedHatRef, openHatRef, samplerRef]);

    return {
        handleSongModeToggle,
        handleSongStructureUpdate,
        handleAddMeasure,
        handleRemoveMeasure,
        handleExportXM,
    };
}

export function useSampleHandlers(deps: {
    audioEngine: AudioEngine | null;
    activeSamplerBank: number;
    ttsPhrases: string[];
    setSampleBuffers: React.Dispatch<React.SetStateAction<(AudioBuffer | null)[]>>;
    setSampler: React.Dispatch<React.SetStateAction<SamplerParams>>;
    setActiveAlignment: React.Dispatch<React.SetStateAction<AlignmentResult | null>>;
}) {
    const { audioEngine, activeSamplerBank, ttsPhrases, setSampleBuffers, setSampler, setActiveAlignment } = deps;

    const handleLoadSample = useCallback(async (name: string, buffer: AudioBuffer, onProgress?: (progress: number) => void) => {
        if (!audioEngine) return;
        await audioEngine.loadSampleToEngine(name, buffer, onProgress);
        setSampleBuffers(prev => {
            const next = [...prev];
            next[activeSamplerBank] = buffer;
            return next;
        });
        const bankName = `bank_${activeSamplerBank}`;
        setSampler(prev => {
            const newParams = [...prev];
            newParams[activeSamplerBank] = { ...newParams[activeSamplerBank], sampleName: bankName };
            return newParams;
        });
        if (audioEngine.prepareVocal) {
            const text = ttsPhrases[activeSamplerBank] || "Hello World";
            void audioEngine.prepareVocal(activeSamplerBank, text).then(() => {
                if (audioEngine.getAlignment) {
                    setActiveAlignment(audioEngine.getAlignment(activeSamplerBank));
                }
            });
        }
    }, [audioEngine, activeSamplerBank, ttsPhrases, setSampleBuffers, setSampler, setActiveAlignment]);

    return { handleLoadSample };
}
