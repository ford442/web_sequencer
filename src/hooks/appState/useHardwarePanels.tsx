import { useMemo } from 'react'
import { Voice303Selector } from '../../components/Voice303Selector'
import {
    legacyEngine303ForModel,
    normalizeTB303Model,
    resolveHighFidModelSelection,
    resolveRealtimeTB303Model,
    stockModelForFamily,
    tb303ModelFamily,
} from '../../engines/TB303Models'
import { ProphecyPanel } from '../../components/ProphecyPanel'
import { OscillatorTypeSelector } from '../../components/OscillatorTypeSelector'
import { OscillatorVariantSelector } from '../../components/OscillatorVariantSelector'
import { SamplerPanel } from '../../components/SamplerPanel'
import { engineTelemetry } from '../../utils/engineTelemetry'
import { Open303Manager } from '../../engines/Open303Manager'
import type { LiveAbSettings } from '../../engines/LiveHighFidAbPair'
import type { HighFidCoefficients, TB303VoiceExtra } from '../../types'
import type { AlignmentResult } from '../../engines/rubberband/PhonemeAligner'
import type { AudioEngine, SynthParams, Bass2Params, SamplerParams, OscillatorType, TB303ModelId } from '../../types'
import { waveformToOscillatorType, getDefaultWaveformForType, getOscillatorPanelClasses } from '../../components/oscillatorThemes'
import { HARMONIZE_PRESETS, layersIntervalsForChord, type HarmonizerConfig } from '../../engines/Harmonizer'

/**
 * Selector props for the per-song high-fid state (L2 A/B + L3 coefficients).
 * Writes go to song state only; useAppState syncs `model303Extra` into the
 * Open303Manager, so load, undo and UI edits all take the same path.
 */
function highFidExtraProps(
    extra: TB303VoiceExtra | undefined,
    update: (updates: { model303Extra: TB303VoiceExtra }) => void,
) {
    return {
        liveAb: extra?.ab,
        onLiveAbChange: (ab: LiveAbSettings) => update({ model303Extra: { ...extra, ab } }),
        highFidCoefficients: extra?.highFidCoefficients,
        onHighFidCoefficientsChange: (highFidCoefficients: HighFidCoefficients | undefined) => {
            const next: TB303VoiceExtra = { ...extra, highFidCoefficients };
            if (!highFidCoefficients) delete next.highFidCoefficients;
            update({ model303Extra: next });
        },
    };
}

export function useHardwarePanels(deps: {
    synthA: SynthParams;
    synthB: SynthParams;
    bass2: Bass2Params;
    sampler: SamplerParams;
    updateSynthA: (updates: Partial<SynthParams>) => void;
    updateSynthB: (updates: Partial<SynthParams>) => void;
    updateBass2: (updates: Partial<Bass2Params>) => void;
    updateSampler: (u: SamplerParams) => void;
    audioEngine: AudioEngine | null;
    activeSamplerBank: number;
    setActiveSamplerBank: React.Dispatch<React.SetStateAction<number>>;
    isVoiceEditorOpen: boolean;
    setIsVoiceEditorOpen: React.Dispatch<React.SetStateAction<boolean>>;
    ttsPhrases: string[];
    handleTtsPhraseChange: (newPhrases: string[]) => void;
    handleGenerateTTS: (text: string) => Promise<void>;
    handleSamplerParamChange: (bankIdx: number, key: string, val: unknown) => void;
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
    handleHarmonizerConfigChange: (config: HarmonizerConfig, isActive: boolean) => void;
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
        handleHarmonizerConfigChange,
    } = deps;

    const synthAChild = useMemo(() => {
        const is303 = synthA.waveform === '303-saw' || synthA.waveform === '303-sqr';
        const isProphecy = synthA.waveform?.startsWith('prophecy-') ?? false;
        const modelA = normalizeTB303Model(synthA.model303, synthA.engine303);
        const realtimeA = resolveRealtimeTB303Model(modelA, synthA.engine303, { reportFallback: false });
        const currentTypeA: OscillatorType = waveformToOscillatorType(
            synthA.waveform,
            legacyEngine303ForModel(realtimeA),
        );
        const panelClassesA = getOscillatorPanelClasses(currentTypeA);

        const handleSynthAVoiceChange = (m: TB303ModelId) => {
            const selection = resolveHighFidModelSelection(m, undefined, {
                report: true,
                subsystem: 'synthA-model303',
            });
            // Persist requested id (incl. offline high-fid); mirror legacy engine303.
            updateSynthA({
                model303: selection.persisted,
                engine303: legacyEngine303ForModel(selection.persisted),
            });
            const mgr = audioEngine?.open303Engine;
            if (mgr instanceof Open303Manager) mgr.setLead303Model(selection.realtime);
            engineTelemetry.registerResolution('synthA-model303', selection.persisted, 'user-initiated');
        };

        const handleSynthATypeChange = (newType: OscillatorType) => {
            const nextWave = getDefaultWaveformForType(newType);
            const update: Partial<SynthParams> = { waveform: nextWave };
            if (newType === 'open303' || newType === 'jc303') {
                const nextModel = stockModelForFamily(newType);
                update.model303 = nextModel;
                update.engine303 = newType;
                updateSynthA(update);
                const mgr = audioEngine?.open303Engine;
                if (mgr instanceof Open303Manager) mgr.setLead303Model(nextModel);
            } else {
                updateSynthA(update);
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
                <OscillatorVariantSelector
                    type={currentTypeA}
                    selected={synthA.waveform}
                    onChange={(w) => updateSynthA({ waveform: w })}
                    accentColor="cyan"
                />
                {is303 && (
                    <Voice303Selector
                        model={modelA}
                        onChange={handleSynthAVoiceChange}
                        accentColor="cyan"
                        {...highFidExtraProps(synthA.model303Extra, updateSynthA)}
                    />
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
    }, [synthA.waveform, synthA.engine303, synthA.model303, synthA.model303Extra, synthA.vowel, synthA.portamento, synthA.formantShift, updateSynthA, audioEngine]);

    const synthBChild = useMemo(() => {
        const is303 = synthB.waveform === '303-saw' || synthB.waveform === '303-sqr';
        const isProphecy = synthB.waveform?.startsWith('prophecy-') ?? false;
        const modelB = normalizeTB303Model(synthB.model303, synthB.engine303);
        const realtimeB = resolveRealtimeTB303Model(modelB, synthB.engine303, { reportFallback: false });
        const currentTypeB: OscillatorType = waveformToOscillatorType(
            synthB.waveform,
            legacyEngine303ForModel(realtimeB),
        );
        const panelClassesB = getOscillatorPanelClasses(currentTypeB);

        const handleSynthBVoiceChange = (m: TB303ModelId) => {
            const selection = resolveHighFidModelSelection(m, undefined, {
                report: true,
                subsystem: 'synthB-model303',
            });
            updateSynthB({
                model303: selection.persisted,
                engine303: legacyEngine303ForModel(selection.persisted),
            });
            const mgr = audioEngine?.open303Engine;
            if (mgr instanceof Open303Manager) mgr.setBass1Model(selection.realtime);
            engineTelemetry.registerResolution('synthB-model303', selection.persisted, 'user-initiated');
        };

        const handleSynthBTypeChange = (newType: OscillatorType) => {
            const nextWave = getDefaultWaveformForType(newType);
            const update: Partial<SynthParams> = { waveform: nextWave };
            if (newType === 'open303' || newType === 'jc303') {
                const nextModel = stockModelForFamily(newType);
                update.model303 = nextModel;
                update.engine303 = newType;
                updateSynthB(update);
                const mgr = audioEngine?.open303Engine;
                if (mgr instanceof Open303Manager) mgr.setBass1Model(nextModel);
            } else {
                updateSynthB(update);
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
                <OscillatorVariantSelector
                    type={currentTypeB}
                    selected={synthB.waveform}
                    onChange={(w) => updateSynthB({ waveform: w })}
                    accentColor="pink"
                />
                {is303 && (
                    <Voice303Selector
                        model={modelB}
                        onChange={handleSynthBVoiceChange}
                        accentColor="pink"
                        {...highFidExtraProps(synthB.model303Extra, updateSynthB)}
                    />
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
    }, [synthB.waveform, synthB.engine303, synthB.model303, synthB.model303Extra, synthB.vowel, synthB.portamento, synthB.formantShift, updateSynthB, audioEngine]);

    const bass2Child = useMemo(() => {
        const modelB2 = normalizeTB303Model(bass2.model303, bass2.engine303);
        const handleBass2VoiceChange = (m: TB303ModelId) => {
            const selection = resolveHighFidModelSelection(m, undefined, {
                report: true,
                subsystem: 'bass2-model303',
            });
            updateBass2({
                model303: selection.persisted,
                engine303: legacyEngine303ForModel(selection.persisted),
            });
            const mgr = audioEngine?.open303Engine;
            if (mgr instanceof Open303Manager) mgr.setBass2Model(selection.realtime);
            engineTelemetry.registerResolution('bass2-model303', selection.persisted, 'user-initiated');
        };
        const bass2Type: OscillatorType = tb303ModelFamily(modelB2) === 'jc303' ? 'jc303' : 'open303';
        return (
        <div className="absolute top-4 right-6 pointer-events-none">
            <div className="pointer-events-auto flex flex-col gap-2 p-2 rounded-lg bg-zinc-950/80 border border-pink-500/20 w-fit">
                <OscillatorVariantSelector
                    type={bass2Type}
                    selected={bass2.waveform}
                    onChange={(w) => updateBass2({ waveform: w as '303-saw' | '303-sqr' })}
                    accentColor="pink"
                />
                <Voice303Selector
                    model={modelB2}
                    onChange={handleBass2VoiceChange}
                    accentColor="pink"
                    {...highFidExtraProps(bass2.model303Extra, updateBass2)}
                />
            </div>
        </div>
        );
    }, [bass2.waveform, bass2.engine303, bass2.model303, bass2.model303Extra, updateBass2, audioEngine]);

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
                onHarmonize={async (_bank, chordType, mix) => {
                    const preset = HARMONIZE_PRESETS.layers();
                    preset.customIntervals = layersIntervalsForChord(chordType);
                    if (typeof mix === 'number') preset.busGain = mix;
                    handleHarmonizerConfigChange(preset, true);
                }}
            />
        </div>
    ), [sampler, updateSampler, handleSamplerParamChange, audioEngine, setIsVoiceEditorOpen, isVoiceEditorOpen, activeSamplerBank, handleLoadSample, ttsPhrases, handleTtsPhraseChange, handleGenerateTTS, loadedBanks, sampleBuffers, melodicMode, multisampleReady, multisampleProcessing, activeAlignment, setActiveAlignment, setActiveSamplerBank, sliceHighlightRef, setMelodicMode, handleHarmonizerConfigChange]);

    return { synthAChild, synthBChild, bass2Child, samplerChild };
}
