import { useMemo } from 'react'
import { Engine303Selector } from '../../components/Engine303Selector'
import { ProphecyPanel } from '../../components/ProphecyPanel'
import { CppPanel } from '../../components/CppPanel'
import { OscillatorTypeSelector } from '../../components/OscillatorTypeSelector'
import { OscillatorVariantSelector } from '../../components/OscillatorVariantSelector'
import { SamplerPanel } from '../../components/SamplerPanel'
import { engineTelemetry } from '../../utils/engineTelemetry'
import type { AlignmentResult } from '../../engines/rubberband/PhonemeAligner'
import type { SynthParams, Bass2Params, SamplerParams, OscillatorType } from '../../types'
import { waveformToOscillatorType, getDefaultWaveformForType, getOscillatorPanelClasses } from '../../types'

export function useHardwarePanels(deps: {
    synthA: SynthParams;
    synthB: SynthParams;
    bass2: Bass2Params;
    sampler: SamplerParams;
    updateSynthA: (updates: Partial<SynthParams>) => void;
    updateSynthB: (updates: Partial<SynthParams>) => void;
    updateBass2: (updates: Partial<Bass2Params>) => void;
    updateSampler: (u: SamplerParams) => void;
    audioEngine: any;
    activeSamplerBank: number;
    setActiveSamplerBank: React.Dispatch<React.SetStateAction<number>>;
    isVoiceEditorOpen: boolean;
    setIsVoiceEditorOpen: React.Dispatch<React.SetStateAction<boolean>>;
    ttsPhrases: string[];
    handleTtsPhraseChange: (newPhrases: string[]) => void;
    handleGenerateTTS: (text: string) => Promise<void>;
    handleSamplerParamChange: (bankIdx: number, key: string, val: any) => void;
    handleLoadSample: (name: string, buffer: AudioBuffer, onProgress?: (progress: number) => void) => Promise<void>;
    loadedBanks: boolean[];
    sampleBuffers: (AudioBuffer | null)[];
    sliceHighlightRef: React.MutableRefObject<((slice: number) => void) | null>;
    melodicMode: boolean;
    setMelodicMode: React.Dispatch<React.SetStateAction<boolean>>;
    multisampleReady: boolean[];
    multisampleProcessing: boolean[];
    activeAlignment: AlignmentResult | null;
    setActiveAlignment: React.Dispatch<React.SetStateAction<AlignmentResult | null>>;
}) {
    const {
        synthA, synthB, bass2, sampler,
        updateSynthA, updateSynthB, updateBass2, updateSampler,
        audioEngine, activeSamplerBank, setActiveSamplerBank,
        isVoiceEditorOpen, setIsVoiceEditorOpen,
        ttsPhrases, handleTtsPhraseChange, handleGenerateTTS,
        handleSamplerParamChange, handleLoadSample,
        loadedBanks, sampleBuffers, sliceHighlightRef,
        melodicMode, setMelodicMode, multisampleReady, multisampleProcessing,
        activeAlignment, setActiveAlignment,
    } = deps;

    const synthAChild = useMemo(() => {
        const is303 = synthA.waveform === '303-saw' || synthA.waveform === '303-sqr';
        const isProphecy = synthA.waveform?.startsWith('prophecy-') ?? false;
        const engine = synthA.engine303 ?? 'open303';
        const currentTypeA: OscillatorType = waveformToOscillatorType(synthA.waveform, synthA.engine303);
        const panelClassesA = getOscillatorPanelClasses(currentTypeA);

        const handleSynthAEngineChange = (e: 'open303' | 'jc303') => {
            updateSynthA({ engine303: e });
            const mgr = audioEngine?.open303Engine;
            if (mgr && 'setLead303Engine' in mgr) (mgr as any).setLead303Engine(e);
            engineTelemetry.registerResolution('synthA-engine303', e, 'user-initiated');
        };

        const handleSynthATypeChange = (newType: OscillatorType) => {
            const nextWave = getDefaultWaveformForType(newType);
            const nextEngine = (newType === 'jc303') ? 'jc303' : (newType === 'open303' ? 'open303' : undefined);
            const update: any = { waveform: nextWave };
            if (nextEngine) update.engine303 = nextEngine;
            updateSynthA(update);
            if (newType === 'open303' || newType === 'jc303') {
                const mgr = audioEngine?.open303Engine;
                if (mgr && 'setLead303Engine' in mgr) (mgr as any).setLead303Engine(nextEngine ?? 'open303');
            }
            engineTelemetry.registerResolution('synthA-oscType', newType, 'user-initiated');
        };

        return (
            <div className={`absolute top-4 right-6 pointer-events-none flex flex-col items-end gap-2 rounded-lg p-1 transition-colors ${panelClassesA}`}>
                <div className="pointer-events-auto flex flex-col items-end gap-2 w-fit">
                <OscillatorTypeSelector
                    type={currentTypeA}
                    onChange={handleSynthATypeChange}
                    accentColor="cyan"
                    compact
                />
                {currentTypeA !== 'cpp' && (
                <OscillatorVariantSelector
                    type={currentTypeA}
                    selected={synthA.waveform}
                    onChange={(w) => updateSynthA({ waveform: w })}
                    accentColor="cyan"
                />
                )}
                {currentTypeA === 'cpp' && (
                    <CppPanel
                        waveform={synthA.waveform}
                        fine={synthA.cppFine ?? 0.5}
                        accentColor="cyan"
                        onWaveformChange={(w) => updateSynthA({ waveform: w })}
                        onFineChange={(v) => updateSynthA({ cppFine: v })}
                    />
                )}
                {is303 && (
                    <Engine303Selector engine={engine} onChange={handleSynthAEngineChange} accentColor="cyan" />
                )}
                {isProphecy && (
                    <ProphecyPanel
                        vowel={synthA.vowel ?? 0}
                        portamento={synthA.portamento ?? 0}
                        formantShift={synthA.formantShift ?? 0}
                        accentColor="cyan"
                        onVowelChange={(v) => updateSynthA({ vowel: v })}
                        onPortamentoChange={(v) => updateSynthA({ portamento: v })}
                        onFormantShiftChange={(v) => updateSynthA({ formantShift: v })}
                    />
                )}
                </div>
            </div>
        );
    }, [synthA.waveform, synthA.engine303, synthA.vowel, synthA.portamento, synthA.formantShift, synthA.cppFine, updateSynthA, audioEngine]);

    const synthBChild = useMemo(() => {
        const is303 = synthB.waveform === '303-saw' || synthB.waveform === '303-sqr';
        const isProphecy = synthB.waveform?.startsWith('prophecy-') ?? false;
        const engine = synthB.engine303 ?? 'open303';
        const currentTypeB: OscillatorType = waveformToOscillatorType(synthB.waveform, synthB.engine303);
        const panelClassesB = getOscillatorPanelClasses(currentTypeB);

        const handleSynthBEngineChange = (e: 'open303' | 'jc303') => {
            updateSynthB({ engine303: e });
            const mgr = audioEngine?.open303Engine;
            if (mgr && 'setBass1Engine' in mgr) mgr.setBass1Engine(e);
            engineTelemetry.registerResolution('synthB-engine303', e, 'user-initiated');
        };

        const handleSynthBTypeChange = (newType: OscillatorType) => {
            const nextWave = getDefaultWaveformForType(newType);
            const nextEngine = (newType === 'jc303') ? 'jc303' : (newType === 'open303' ? 'open303' : undefined);
            const update: any = { waveform: nextWave };
            if (nextEngine) update.engine303 = nextEngine;
            updateSynthB(update);
            if (newType === 'open303' || newType === 'jc303') {
                const mgr = audioEngine?.open303Engine;
                if (mgr && 'setBass1Engine' in mgr) mgr.setBass1Engine(nextEngine ?? 'open303');
            }
            engineTelemetry.registerResolution('synthB-oscType', newType, 'user-initiated');
        };

        return (
            <div className={`absolute top-4 right-6 pointer-events-none flex flex-col items-end gap-2 rounded-lg p-1 transition-colors ${panelClassesB}`}>
                <div className="pointer-events-auto flex flex-col items-end gap-2 w-fit">
                <OscillatorTypeSelector
                    type={currentTypeB}
                    onChange={handleSynthBTypeChange}
                    accentColor="pink"
                    compact
                />
                {currentTypeB !== 'cpp' && (
                <OscillatorVariantSelector
                    type={currentTypeB}
                    selected={synthB.waveform}
                    onChange={(w) => updateSynthB({ waveform: w })}
                    accentColor="pink"
                />
                )}
                {currentTypeB === 'cpp' && (
                    <CppPanel
                        waveform={synthB.waveform}
                        fine={synthB.cppFine ?? 0.5}
                        accentColor="pink"
                        onWaveformChange={(w) => updateSynthB({ waveform: w })}
                        onFineChange={(v) => updateSynthB({ cppFine: v })}
                    />
                )}
                {is303 && (
                    <Engine303Selector engine={engine} onChange={handleSynthBEngineChange} accentColor="pink" />
                )}
                {isProphecy && (
                    <ProphecyPanel
                        vowel={synthB.vowel ?? 0}
                        portamento={synthB.portamento ?? 0}
                        formantShift={synthB.formantShift ?? 0}
                        accentColor="pink"
                        onVowelChange={(v) => updateSynthB({ vowel: v })}
                        onPortamentoChange={(v) => updateSynthB({ portamento: v })}
                        onFormantShiftChange={(v) => updateSynthB({ formantShift: v })}
                    />
                )}
                </div>
            </div>
        );
    }, [synthB.waveform, synthB.engine303, synthB.vowel, synthB.portamento, synthB.formantShift, synthB.cppFine, updateSynthB, audioEngine]);

    const bass2Child = useMemo(() => {
        const engine = bass2.engine303 ?? 'open303';
        const handleBass2EngineChange = (e: 'open303' | 'jc303') => {
            updateBass2({ engine303: e });
            const mgr = audioEngine?.open303Engine;
            if (mgr && 'setBass2Engine' in mgr) mgr.setBass2Engine(e);
            engineTelemetry.registerResolution('bass2-engine303', e, 'user-initiated');
        };
        const bass2Type: OscillatorType = engine === 'jc303' ? 'jc303' : 'open303';
        return (
        <div className="absolute top-4 right-6 pointer-events-none">
            <div className="pointer-events-auto flex flex-col gap-2 p-2 rounded-lg bg-zinc-950/80 border border-pink-500/20 w-fit">
                <OscillatorVariantSelector
                    type={bass2Type}
                    selected={bass2.waveform}
                    onChange={(w) => updateBass2({ waveform: w as '303-saw' | '303-sqr' })}
                    accentColor="pink"
                />
                <Engine303Selector engine={engine} onChange={handleBass2EngineChange} accentColor="pink" />
            </div>
        </div>
        );
    }, [bass2.waveform, bass2.engine303, updateBass2, audioEngine]);

    const samplerChild = useMemo(() => (
        <div className="absolute top-2 left-[10%] right-[10%] max-h-[38%] h-auto pointer-events-auto z-10 bg-gray-900/90 rounded-lg border border-purple-500/30 backdrop-blur-sm overflow-y-auto">
            <SamplerPanel
                params={sampler}
                onChange={(u) => updateSampler(u)}
                onParamChange={handleSamplerParamChange}
                onLoadSample={handleLoadSample}
                audioContext={audioEngine?.context!}
                audioEngine={audioEngine || undefined}
                activeBankIdx={activeSamplerBank}
                onBankChange={setActiveSamplerBank}
                onOpenEditor={() => setIsVoiceEditorOpen(true)}
                isVoiceEditorOpen={isVoiceEditorOpen}
                ttsPhrases={ttsPhrases}
                onTtsPhraseChange={handleTtsPhraseChange}
                onGenerateTTS={handleGenerateTTS}
                loadedBanks={loadedBanks}
                sampleBuffer={sampleBuffers[activeSamplerBank]}
                sliceHighlightRef={sliceHighlightRef}
                melodicMode={melodicMode}
                onMelodicModeChange={setMelodicMode}
                multisampleReady={multisampleReady}
                multisampleProcessing={multisampleProcessing}
                alignment={activeAlignment}
                onAlignmentChange={(newAlignment) => {
                    audioEngine?.setAlignment?.(activeSamplerBank, newAlignment);
                    setActiveAlignment(newAlignment);
                }}
            />
        </div>
    ), [sampler, updateSampler, handleSamplerParamChange, audioEngine, setIsVoiceEditorOpen, isVoiceEditorOpen, activeSamplerBank, handleLoadSample, ttsPhrases, handleTtsPhraseChange, handleGenerateTTS, loadedBanks, sampleBuffers, melodicMode, multisampleReady, multisampleProcessing, activeAlignment, setActiveAlignment, setActiveSamplerBank, sliceHighlightRef, setMelodicMode]);

    return { synthAChild, synthBChild, bass2Child, samplerChild };
}
