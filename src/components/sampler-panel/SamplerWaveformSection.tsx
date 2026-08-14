import React from 'react';
import { WaveformDisplay } from '../WaveformDisplay';
import type { AlignmentResult } from '../../engines/rubberband/PhonemeAligner';

interface SamplerWaveformSectionProps {
  sampleBuffer?: AudioBuffer | null;
  currentAlignment: AlignmentResult | null;
  sliceHighlightRef: React.MutableRefObject<((slice: number) => void) | null>;
  onAlignmentChange: (alignment: AlignmentResult) => void;
  onAutoSlice: () => void;
  autoSliceSensitivity: number;
  onAutoSliceSensitivityChange: (value: number) => void;
  activeProgress: { bankIdx: number; progress: number; isProcessing: boolean } | null;
  activeBankIdx: number;
  onLoadSample?: () => void;
}

export const SamplerWaveformSection = React.memo(function SamplerWaveformSection({
  sampleBuffer,
  currentAlignment,
  sliceHighlightRef,
  onAlignmentChange,
  onAutoSlice,
  autoSliceSensitivity,
  onAutoSliceSensitivityChange,
  activeProgress,
  activeBankIdx,
  onLoadSample,
}: SamplerWaveformSectionProps) {
  return (
    <>
      <div className="flex justify-between items-center px-1 mb-1">
        <span className="text-[10px] font-orbitron font-bold text-gray-400">CUSTOM SAMPLE SLICING UI</span>
      </div>
      <WaveformDisplay
        buffer={sampleBuffer || null}
        alignment={currentAlignment}
        sliceHighlightRef={sliceHighlightRef}
        onAlignmentChange={onAlignmentChange}
        onAutoSlice={onAutoSlice}
        autoSliceSensitivity={autoSliceSensitivity}
        onAutoSliceSensitivityChange={onAutoSliceSensitivityChange}
        onLoadSample={onLoadSample}
      />

      {activeProgress?.bankIdx === activeBankIdx && activeProgress.isProcessing && (
        <div className="bg-gray-800/50 rounded p-2 border border-purple-500/30">
          <div className="flex items-center justify-between text-[9px] text-purple-300 mb-1.5">
            <span className="flex items-center gap-1.5">
              <svg className="animate-spin h-3 w-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              Generating Multisamples...
            </span>
            <span className="font-mono">{Math.round(activeProgress.progress * 100)}%</span>
          </div>
          <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-purple-500 via-cyan-500 to-purple-500 transition-all duration-200 ease-out"
              style={{ width: `${activeProgress.progress * 100}%` }}
            />
          </div>
          <div className="text-[8px] text-gray-500 mt-1">
            Pre-rendering pitch variations for instant playback
          </div>
        </div>
      )}
    </>
  );
});
