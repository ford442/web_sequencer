import { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import type { SamplerBankParams } from '../../types';
import type { PitchControlValues } from '../SamplerPitchControls';
import { SupertonicService } from '../../services/Supertonic';
import { PhonemeAligner } from '../../engines/rubberband/PhonemeAligner';
import type { AlignmentResult } from '../../engines/rubberband/PhonemeAligner';
import type { SamplerPanelProps } from './types';
import { DEFAULT_BANK_PARAMS } from './types';
import { MODES } from './SamplerModeSelector';

type PanelProps = Pick<SamplerPanelProps,
  | 'params' | 'onChange' | 'onLoadSample' | 'audioEngine' | 'activeBankIdx'
  | 'onBankChange' | 'ttsPhrases' | 'onTtsPhraseChange' | 'onGenerateTTS'
  | 'onHarmonize' | 'onParamChange' | 'sampleBuffer' | 'multisampleProgress'
>;

export function useSamplerPanelState({
  params,
  onChange,
  onLoadSample,
  audioEngine,
  activeBankIdx,
  onBankChange,
  ttsPhrases,
  onTtsPhraseChange,
  onGenerateTTS,
  onHarmonize,
  onParamChange,
  sampleBuffer,
  multisampleProgress,
}: PanelProps) {
  const [status, setStatus] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [ttsReady, setTtsReady] = useState(false);
  const [flashBankIdx, setFlashBankIdx] = useState<number | null>(null);
  const flashTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isProcessingHarmonize, setIsProcessingHarmonize] = useState(false);
  const [chordType, setChordType] = useState('minor');
  const [localProgress, setLocalProgress] = useState<{ bankIdx: number; progress: number; isProcessing: boolean } | null>(null);
  const [autoSliceSensitivity, setAutoSliceSensitivity] = useState(50);

  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const shouldFocusRef = useRef(false);
  const modeRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const activeProgress = multisampleProgress || localProgress;

  const currentParams = useMemo(() => {
    const bank = params[activeBankIdx];
    if (bank) return { ...DEFAULT_BANK_PARAMS, ...bank, sampleName: bank.sampleName || `bank_${activeBankIdx}` };
    return { ...DEFAULT_BANK_PARAMS, sampleName: `bank_${activeBankIdx}` };
  }, [params, activeBankIdx]);

  const updateParam = useCallback((key: keyof SamplerBankParams, value: number | string | boolean | number[]) => {
    const newParams = [...params];
    newParams[activeBankIdx] = { ...currentParams, [key]: value };
    onChange(newParams);
  }, [params, activeBankIdx, currentParams, onChange]);

  const updateParamRef = useRef(updateParam);
  useEffect(() => { updateParamRef.current = updateParam; });

  const paramHandlers = useMemo(() => {
    const paramNames = [
      'playbackSpeed', 'volume', 'filterCutoff', 'drive',
      'timeRatio', 'pitchScale', 'formantShift', 'vibratoDepth',
      'tremoloRate', 'tremoloDepth', 'breathIntensity', 'freeze',
      'freezeLfoSync', 'formantLfoSync', 'formantEnvSync', 'freezeLfoRate', 'freezeLfoDepth', 'freezeEnvDepth', 'timeStretchEnvDepth', 'grainLfoRate', 'grainLfoDepth', 'grainEnvDepth', 'grainPitchEnvDepth', 'grainJitter', 'grainPitchQuantize', 'granularPitchShift', 'windowShape', 'customGrainEnvelope', 'formantEnvFollower', 'formantSidechainDepth',
      'vocoderMix', 'vocoderFormantShift', 'vocoderPreservation', 'vocoderAttack', 'vocoderRelease',
      'formantLfoRate', 'formantLfoDepth', 'customLfoShape', 'characterMorph', 'attack', 'decay',
      'pitchAmount', 'pitchAttack', 'pitchDecay',
      'sustain', 'release', 'choir', 'glitchChance', 'gateDepth', 'gateRate', 'reverbLfoRate', 'reverbLfoDepth', 'bitcrush', 'spectralComp', 'downsample',
    ] as const;
    return Object.fromEntries(paramNames.map(p => [p, (v: unknown) => {
      if (onParamChange) onParamChange(activeBankIdx, p, v);
      else updateParamRef.current(p as keyof SamplerBankParams, v as number);
    }])) as Record<typeof paramNames[number], (v: unknown) => void>;
  }, [activeBankIdx, onParamChange]);

  const handlePitchControlChange = useCallback((key: keyof PitchControlValues, value: number | string | boolean) => {
    if (onParamChange) {
      onParamChange(activeBankIdx, key, value);
    } else {
      const newParams = [...params];
      newParams[activeBankIdx] = { ...currentParams, [key]: value };
      onChange(newParams);
    }

    if (audioEngine?.singingVoice) {
      const voice = audioEngine.singingVoice;
      switch (key) {
        case 'coarseTune':
        case 'fineTune': {
          const coarse = key === 'coarseTune' ? (value as number) : (currentParams.coarseTune ?? 0);
          const fine = key === 'fineTune' ? (value as number) : (currentParams.fineTune ?? 0);
          const scale = Math.pow(2, (coarse + fine / 1200) / 12);
          voice.setPitch(scale);
          break;
        }
        case 'formantShift':
          voice.setFormantShift(value as number);
          break;
        case 'stretchProfile': {
          const node = voice.getSourceNode();
          if (node && 'port' in node) {
            (node as AudioWorkletNode).port.postMessage({
              type: 'setStretchProfile',
              data: { profile: value },
            });
          }
          break;
        }
        case 'lockToSequencer': {
          const node2 = voice.getSourceNode();
          if (node2 && 'port' in node2) {
            (node2 as AudioWorkletNode).port.postMessage({
              type: 'setAutoFollow',
              enabled: value as boolean,
            });
          }
          break;
        }
      }
    }
  }, [activeBankIdx, onParamChange, currentParams, audioEngine, params, onChange]);

  const handleModeChange = useCallback((mode: 'loop' | 'stretch' | 'wavetable') => {
    if (onParamChange) {
      onParamChange(activeBankIdx, 'mode', mode);
    } else {
      const newParams = [...params];
      newParams[activeBankIdx] = { ...currentParams, mode };
      onChange(newParams);
    }
    if (audioEngine?.setSustainMode) {
      audioEngine.setSustainMode(mode);
    }
  }, [activeBankIdx, onParamChange, currentParams, params, onChange, audioEngine]);

  const handleGrainSizeChange = useCallback((size: number) => {
    if (onParamChange) {
      onParamChange(activeBankIdx, 'grainSize', size);
    } else {
      const newParams = [...params];
      newParams[activeBankIdx] = { ...currentParams, grainSize: size };
      onChange(newParams);
    }
    if (audioEngine?.setSustainGrainSize) {
      audioEngine.setSustainGrainSize(size);
    }
  }, [activeBankIdx, onParamChange, currentParams, params, onChange, audioEngine]);

  const handleSliceModeToggle = useCallback(() => {
    const newVal = currentParams.sliceMode === 'phoneme' ? 'off' : 'phoneme';
    if (onParamChange) onParamChange(activeBankIdx, 'sliceMode', newVal);
    else updateParamRef.current('sliceMode', newVal);
  }, [activeBankIdx, currentParams.sliceMode, onParamChange]);

  useEffect(() => {
    if (audioEngine?.setSustainMode && currentParams.mode) {
      audioEngine.setSustainMode(currentParams.mode);
    }
    if (audioEngine?.setSustainGrainSize && currentParams.grainSize) {
      audioEngine.setSustainGrainSize(currentParams.grainSize);
    }
  }, [activeBankIdx, audioEngine, currentParams.mode, currentParams.grainSize]);

  useEffect(() => {
    if (shouldFocusRef.current) {
      tabRefs.current[activeBankIdx]?.focus();
      shouldFocusRef.current = false;
    }
  }, [activeBankIdx]);

  useEffect(() => {
    const ready = SupertonicService.getInstance().isServiceReady();
    if (ready) {
      setTtsReady(true);
      return;
    }
    const interval = setInterval(() => {
      if (SupertonicService.getInstance().isServiceReady()) {
        setTtsReady(true);
        clearInterval(interval);
      }
    }, 500);
    return () => clearInterval(interval);
  }, []);

  const loadBufferToBank = useCallback(async (buffer: AudioBuffer) => {
    const bankName = `bank_${activeBankIdx}`;
    setLocalProgress({ bankIdx: activeBankIdx, progress: 0, isProcessing: true });
    setStatus('Processing...');

    try {
      await onLoadSample(bankName, buffer, (progress) => {
        if (progress === -1) {
          setLocalProgress(prev => prev ? { ...prev, isProcessing: false } : null);
          setStatus('Processing Error');
        } else if (progress >= 1.0) {
          setLocalProgress(null);
          setStatus(`Ready: ${bankName}`);
        } else {
          setLocalProgress({ bankIdx: activeBankIdx, progress, isProcessing: true });
        }
      });

      if (currentParams.sampleName !== bankName) {
        const newParams = [...params];
        newParams[activeBankIdx] = { ...currentParams, sampleName: bankName };
        onChange(newParams);
      }

      if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current);
      setFlashBankIdx(activeBankIdx);
      flashTimeoutRef.current = setTimeout(() => setFlashBankIdx(null), 1000);
    } catch (err) {
      console.error('Failed to load sample:', err);
      setLocalProgress(null);
      setStatus('Load Error');
    }
  }, [activeBankIdx, onLoadSample, currentParams, params, onChange]);

  const currentTtsText = (ttsPhrases && activeBankIdx >= 0 && activeBankIdx < 8)
    ? (ttsPhrases[activeBankIdx] || 'Hello World')
    : 'Hello World';

  const setCurrentTtsText = useCallback((text: string) => {
    if (activeBankIdx < 0 || activeBankIdx >= 8) {
      console.warn(`Invalid bank index: ${activeBankIdx}`);
      return;
    }
    const newPhrases = [...ttsPhrases];
    newPhrases[activeBankIdx] = text;
    onTtsPhraseChange(newPhrases);
  }, [activeBankIdx, ttsPhrases, onTtsPhraseChange]);

  const handleTTS = useCallback(async () => {
    if (!onGenerateTTS) return;
    if (!SupertonicService.getInstance().isServiceReady()) {
      setStatus('Engine not ready');
      return;
    }
    setIsGenerating(true);
    setStatus('Generating...');
    try {
      await onGenerateTTS(currentTtsText);
      setStatus(`Gen: Bank ${activeBankIdx + 1}`);
    } catch (e) {
      console.error(e);
      setStatus('Gen Error');
    } finally {
      setIsGenerating(false);
    }
  }, [onGenerateTTS, currentTtsText, activeBankIdx]);

  const handleHarmonizeClick = useCallback(async () => {
    if (!onHarmonize) return;
    setIsProcessingHarmonize(true);
    setStatus('Harmonizing...');
    try {
      await onHarmonize(activeBankIdx, chordType);
      setStatus('Harmonized!');
    } catch (e) {
      console.error(e);
      setStatus('Error');
    } finally {
      setIsProcessingHarmonize(false);
    }
  }, [onHarmonize, activeBankIdx, chordType]);

  const handleBankKeyDown = useCallback((e: React.KeyboardEvent, index: number) => {
    let nextIndex = -1;
    if (e.key === 'ArrowRight') nextIndex = (index + 1) % 8;
    else if (e.key === 'ArrowLeft') nextIndex = (index - 1 + 8) % 8;
    else if (e.key === 'Home') nextIndex = 0;
    else if (e.key === 'End') nextIndex = 7;

    if (nextIndex !== -1) {
      e.preventDefault();
      shouldFocusRef.current = true;
      onBankChange(nextIndex);
    }
  }, [onBankChange]);

  const handleModeKeyDown = useCallback((e: React.KeyboardEvent, index: number) => {
    let nextIndex = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      nextIndex = (index + 1) % MODES.length;
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      nextIndex = (index - 1 + MODES.length) % MODES.length;
    }
    if (nextIndex !== -1) {
      e.preventDefault();
      handleModeChange(MODES[nextIndex]);
      setTimeout(() => modeRefs.current[nextIndex]?.focus(), 0);
    }
  }, [handleModeChange]);

  const [currentAlignment, setCurrentAlignment] = useState<AlignmentResult | null>(
    (audioEngine?.getAlignment && activeBankIdx >= 0) ? audioEngine.getAlignment(activeBankIdx) : null
  );

  useEffect(() => {
    const alg = (audioEngine?.getAlignment && activeBankIdx >= 0) ? audioEngine.getAlignment(activeBankIdx) : null;
    setCurrentAlignment(alg);
  }, [activeBankIdx, audioEngine]);

  const handleAlignmentChange = useCallback((newAlignment: AlignmentResult) => {
    setCurrentAlignment(newAlignment);
    if (audioEngine?.setAlignment && activeBankIdx >= 0) {
      audioEngine.setAlignment(activeBankIdx, newAlignment);
    }
  }, [audioEngine, activeBankIdx]);

  const handleAutoSlice = useCallback(() => {
    if (!sampleBuffer) return;
    try {
      const floatData = new Float32Array(sampleBuffer.length);
      if (sampleBuffer.numberOfChannels === 2) {
        const left = sampleBuffer.getChannelData(0);
        const right = sampleBuffer.getChannelData(1);
        for (let i = 0; i < floatData.length; i++) {
          floatData[i] = (left[i] + right[i]) * 0.5;
        }
      } else {
        floatData.set(sampleBuffer.getChannelData(0));
      }

      const thresholdMultiplier = 3.0 - (autoSliceSensitivity / 100) * 2.9;
      const segments = PhonemeAligner.detectSegmentBoundaries(floatData, sampleBuffer.sampleRate, -1, thresholdMultiplier);

      const phonemes = segments.map((seg, idx) => ({
        phoneme: `S${idx + 1}`,
        start: seg.start,
        end: seg.end,
        isVowel: true,
        category: 'plosive' as const,
      }));

      handleAlignmentChange({
        phonemes,
        sampleRate: sampleBuffer.sampleRate,
        duration: sampleBuffer.duration,
        text: '',
      });
    } catch (e) {
      console.error('Auto-slice failed:', e);
    }
  }, [sampleBuffer, handleAlignmentChange, autoSliceSensitivity]);

  const handleCustomLfoShapeChange = useCallback((newValue: number[]) => {
    if (onParamChange) onParamChange(activeBankIdx, 'customLfoShape', newValue);
    else updateParamRef.current('customLfoShape', newValue);
  }, [activeBankIdx, onParamChange]);

  const handleCustomGrainEnvelopeChange = useCallback((newValue: number[]) => {
    if (onParamChange) onParamChange(activeBankIdx, 'customGrainEnvelope', newValue);
    else updateParamRef.current('customGrainEnvelope', newValue);
  }, [activeBankIdx, onParamChange]);

  const handleMorphTargetChange = useCallback((value: string) => {
    updateParamRef.current('morphTarget', value);
  }, []);

  const handleFormantEnvAttackChange = useCallback((v: number) => updateParam('formantEnvAttack', v), [updateParam]);
  const handleFormantEnvDecayChange = useCallback((v: number) => updateParam('formantEnvDecay', v), [updateParam]);
  const handleFormantEnvAmountChange = useCallback((v: number) => updateParam('formantEnvAmount', v), [updateParam]);
  const handleFormantEnvFollowerChange = useCallback((v: number) => updateParam('formantEnvFollower', v), [updateParam]);
  const handleFormantSidechainDepthChange = useCallback((v: number) => updateParam('formantSidechainDepth', v), [updateParam]);

  return {
    status,
    setStatus,
    isGenerating,
    ttsReady,
    flashBankIdx,
    isProcessingHarmonize,
    chordType,
    setChordType,
    activeProgress,
    tabRefs,
    modeRefs,
    currentParams,
    updateParamRef,
    paramHandlers,
    handlePitchControlChange,
    handleModeChange,
    handleGrainSizeChange,
    handleSliceModeToggle,
    loadBufferToBank,
    currentTtsText,
    setCurrentTtsText,
    handleTTS,
    handleHarmonizeClick,
    handleBankKeyDown,
    handleModeKeyDown,
    currentAlignment,
    handleAlignmentChange,
    autoSliceSensitivity,
    setAutoSliceSensitivity,
    handleAutoSlice,
    handleCustomLfoShapeChange,
    handleCustomGrainEnvelopeChange,
    handleMorphTargetChange,
    handleFormantEnvAttackChange,
    handleFormantEnvDecayChange,
    handleFormantEnvAmountChange,
    handleFormantEnvFollowerChange,
    handleFormantSidechainDepthChange,
  };
}
