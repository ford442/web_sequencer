import React, { useRef, memo } from 'react';
import { SamplerToolbar } from './sampler-panel/SamplerToolbar';
import { SamplerPitchControls } from './SamplerPitchControls';
import { SamplerBankTabs } from './sampler-panel/SamplerBankTabs';
import { SamplerDragOverlay } from './sampler-panel/SamplerDragOverlay';
import { SamplerWaveformSection } from './sampler-panel/SamplerWaveformSection';
import { SamplerModeSelector } from './sampler-panel/SamplerModeSelector';
import { MelodicLyricModeToggle } from './sampler-panel/MelodicLyricModeToggle';
import { SamplerKnobControls } from './sampler-panel/SamplerKnobControls';
import { useSamplerPanelState } from './sampler-panel/useSamplerPanelState';
import { useSamplerRecording } from './sampler-panel/useSamplerRecording';
import { useSamplerFileLoading } from './sampler-panel/useSamplerFileLoading';
import type { SamplerPanelProps } from './sampler-panel/types';

const SamplerPanelComponent: React.FC<SamplerPanelProps> = React.memo(({
  params, onChange, onLoadSample, audioContext, audioEngine, activeBankIdx, onBankChange, onOpenEditor, isVoiceEditorOpen,
  ttsPhrases, onTtsPhraseChange, onGenerateTTS,
  onHarmonize, onParamChange, loadedBanks, sampleBuffer, sliceHighlightRef,
  melodicMode = false, onMelodicModeChange,
  multisampleProgress,
  multisampleReady,
  multisampleProcessing,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dummyRef = useRef(null);

  const state = useSamplerPanelState({
    params, onChange, onLoadSample, audioEngine, activeBankIdx,
    onBankChange, ttsPhrases, onTtsPhraseChange, onGenerateTTS,
    onHarmonize, onParamChange, sampleBuffer, multisampleProgress,
  });

  const { isRecording, toggleRecording } = useSamplerRecording(
    audioContext,
    state.loadBufferToBank,
  );

  const fileLoading = useSamplerFileLoading(audioContext, state.loadBufferToBank);

  const h = state.paramHandlers;

  return (
    <div
      className="flex flex-col h-full bg-[#1a1d24] text-white overflow-hidden select-none relative"
      onDragOver={fileLoading.handleDragOver}
      onDragLeave={fileLoading.handleDragLeave}
      onDrop={(e) => fileLoading.handleDrop(e, state.setStatus)}
    >
      <SamplerDragOverlay isDragging={fileLoading.isDragging} activeBankIdx={activeBankIdx} />

      <SamplerBankTabs
        activeBankIdx={activeBankIdx}
        flashBankIdx={state.flashBankIdx}
        loadedBanks={loadedBanks}
        multisampleReady={multisampleReady}
        multisampleProcessing={multisampleProcessing}
        tabRefs={state.tabRefs}
        onBankChange={onBankChange}
        onKeyDown={state.handleBankKeyDown}
        status={state.status}
      />

      <div
        id="sampler-bank-panel"
        role="tabpanel"
        aria-labelledby={`sampler-bank-tab-${activeBankIdx}`}
        className="flex-1 overflow-y-auto p-2 space-y-2 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-gray-700"
      >
        <SamplerWaveformSection
          sampleBuffer={sampleBuffer}
          currentAlignment={state.currentAlignment}
          sliceHighlightRef={sliceHighlightRef || dummyRef}
          onAlignmentChange={state.handleAlignmentChange}
          onAutoSlice={state.handleAutoSlice}
          autoSliceSensitivity={state.autoSliceSensitivity}
          onAutoSliceSensitivityChange={state.setAutoSliceSensitivity}
          activeProgress={state.activeProgress}
          activeBankIdx={activeBankIdx}
        />

        <SamplerToolbar
          fileInputRef={fileInputRef}
          handleFileChange={(e) => fileLoading.handleFileChange(e, state.setStatus)}
          isRecording={isRecording}
          toggleRecording={() => toggleRecording(state.setStatus)}
          currentTtsText={state.currentTtsText}
          setCurrentTtsText={state.setCurrentTtsText}
          ttsReady={state.ttsReady}
          isGenerating={state.isGenerating}
          handleTTS={state.handleTTS}
          onOpenEditor={onOpenEditor}
          isVoiceEditorOpen={isVoiceEditorOpen}
          chordType={state.chordType}
          setChordType={state.setChordType}
          isProcessingHarmonize={state.isProcessingHarmonize}
          handleHarmonizeClick={state.handleHarmonizeClick}
          onHarmonize={!!onHarmonize}
        />

        <SamplerModeSelector
          currentParams={state.currentParams}
          modeRefs={state.modeRefs}
          onModeChange={state.handleModeChange}
          onModeKeyDown={state.handleModeKeyDown}
          onGrainSizeChange={state.handleGrainSizeChange}
          onSliceModeToggle={state.handleSliceModeToggle}
        />

        <MelodicLyricModeToggle
          melodicMode={melodicMode}
          onMelodicModeChange={onMelodicModeChange}
        />

        <SamplerPitchControls
          bankId={activeBankIdx}
          values={{
            rootNote: state.currentParams.rootNote ?? 60,
            coarseTune: state.currentParams.coarseTune ?? 0,
            fineTune: state.currentParams.fineTune ?? 0,
            formantShift: state.currentParams.formantShift ?? 0,
            stretchProfile: state.currentParams.stretchProfile ?? 'vocal',
            stretchMode: state.currentParams.stretchMode ?? 'Pitch',
            lockToSequencer: state.currentParams.lockToSequencer ?? false,
          }}
          onChange={state.handlePitchControlChange}
        />

        <SamplerKnobControls
          currentParams={state.currentParams}
          handlers={h}
          onCustomLfoShapeChange={state.handleCustomLfoShapeChange}
          onCustomGrainEnvelopeChange={state.handleCustomGrainEnvelopeChange}
          onMorphTargetChange={state.handleMorphTargetChange}
          onFormantEnvAttackChange={state.handleFormantEnvAttackChange}
          onFormantEnvDecayChange={state.handleFormantEnvDecayChange}
          onFormantEnvAmountChange={state.handleFormantEnvAmountChange}
          onFormantEnvFollowerChange={state.handleFormantEnvFollowerChange}
          onFormantSidechainDepthChange={state.handleFormantSidechainDepthChange}
        />
      </div>
    </div>
  );
});

export const SamplerPanel = memo(SamplerPanelComponent, (prev, next) => {
  if (prev.activeBankIdx !== next.activeBankIdx) return false;
  if (prev.params[prev.activeBankIdx] !== next.params[next.activeBankIdx]) return false;

  const prevTTS = prev.ttsPhrases?.[prev.activeBankIdx];
  const nextTTS = next.ttsPhrases?.[next.activeBankIdx];
  if (prevTTS !== nextTTS) return false;

  if (prev.audioEngine !== next.audioEngine) return false;
  if (prev.loadedBanks !== next.loadedBanks) return false;
  if (prev.sampleBuffer !== next.sampleBuffer) return false;
  if (prev.sliceHighlightRef !== next.sliceHighlightRef) return false;
  if (prev.onGenerateTTS !== next.onGenerateTTS) return false;
  if (prev.alignment !== next.alignment) return false;

  return true;
});

export type { SamplerPanelProps } from './sampler-panel/types';
