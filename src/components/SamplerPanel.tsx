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
  });

export { SamplerPanelComponent as SamplerPanel };
