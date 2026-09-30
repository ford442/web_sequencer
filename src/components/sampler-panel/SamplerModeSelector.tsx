import React from 'react';
import type { SamplerBankParams } from '../../types';
import { grainSizeToMs, grainSizeToPercent } from './types';

const MODES: ('loop' | 'stretch' | 'wavetable')[] = ['loop', 'stretch', 'wavetable'];

interface SamplerModeSelectorProps {
  currentParams: SamplerBankParams;
  modeRefs: React.MutableRefObject<(HTMLButtonElement | null)[]>;
  onModeChange: (mode: 'loop' | 'stretch' | 'wavetable') => void;
  onModeKeyDown: (e: React.KeyboardEvent, index: number) => void;
  onGrainSizeChange: (size: number) => void;
  onSliceModeToggle: () => void;
}

export const SamplerModeSelector = React.memo(function SamplerModeSelector({
  currentParams,
  modeRefs,
  onModeChange,
  onModeKeyDown,
  onGrainSizeChange,
  onSliceModeToggle,
}: SamplerModeSelectorProps) {
  return (
    <div className="bg-gray-800/30 p-1.5 rounded">
      <div className="flex gap-1 items-center mb-1.5">
        <label className="text-[10px] text-gray-400 font-bold w-10" id="sampler-mode-label">MODE:</label>
        <div className="flex gap-1 flex-1" role="radiogroup" aria-labelledby="sampler-mode-label">
          {MODES.map((mode, i) => {
            const isSelected = (currentParams.mode || 'loop') === mode;
            return (
              <button type="button"
                key={mode}
                ref={(el) => { modeRefs.current[i] = el; }}
                onClick={() => onModeChange(mode)}
                onKeyDown={(e) => onModeKeyDown(e, i)}
                tabIndex={isSelected ? 0 : -1}
                className={`flex-1 px-1 h-6 text-[9px] font-bold rounded border transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-400 ${
                  isSelected
                    ? 'bg-purple-600 border-purple-400 text-white'
                    : 'bg-gray-800 border-gray-600 text-gray-400 hover:bg-gray-700'
                }`}
                aria-label={`${mode.charAt(0).toUpperCase() + mode.slice(1)} Mode`}
                role="radio"
                aria-checked={isSelected}
              >
                {mode === 'wavetable' ? 'WAVE' : mode.toUpperCase()}
              </button>
            );
          })}
        </div>
      </div>
      {(currentParams.mode || 'loop') === 'stretch' && (
        <div className="flex flex-col gap-1.5 mt-1 border-t border-white/5 pt-1">
          <div className="flex gap-1 items-center">
            <label htmlFor="sampler-grain-size" className="text-[9px] text-gray-500 w-10">Grain:</label>
            <input
              id="sampler-grain-size"
              type="range"
              min="441"
              max="22050"
              step="441"
              value={currentParams.grainSize || 4410}
              onChange={(e) => onGrainSizeChange(Number(e.target.value))}
              className="flex-1 h-1.5 bg-gray-700 rounded appearance-none cursor-pointer"
              aria-label="Grain Size"
              style={{
                background: `linear-gradient(to right, #9333ea 0%, #9333ea ${grainSizeToPercent(currentParams.grainSize || 4410)}%, #374151 ${grainSizeToPercent(currentParams.grainSize || 4410)}%, #374151 100%)`,
              }}
              aria-valuetext={grainSizeToMs(currentParams.grainSize || 4410) + 'ms'}
            />
            <span className="text-[9px] text-gray-500 w-8 text-right">{grainSizeToMs(currentParams.grainSize || 4410)}ms</span>
          </div>
          <div className="flex gap-1 items-center">
            <label id="sampler-slice-label" className="text-[9px] text-gray-500 w-10">Slice:</label>
            <button type="button"
              aria-label="Toggle Phoneme Slice Mode"
              aria-pressed={currentParams.sliceMode === 'phoneme'}
              onClick={onSliceModeToggle}
              className={`flex-1 h-5 text-[9px] font-bold rounded border transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-400 ${
                currentParams.sliceMode === 'phoneme'
                  ? 'bg-purple-600 border-purple-400 text-white'
                  : 'bg-gray-800 border-gray-600 text-gray-400 hover:bg-gray-700'
              }`}
            >
              {currentParams.sliceMode === 'phoneme' ? 'ON (PHONEMES)' : 'OFF'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
});

export { MODES };
