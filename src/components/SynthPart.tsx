
import React, { useCallback, useMemo } from 'react';
import type { SynthParams } from '../types';
import { Knob } from './Knob';
import { WaveformSelector } from './WaveformSelector';

const FILTER_MODE_18_DB = 18;
const FILTER_MODE_24_DB = 24;
const FILTER_MODE_STEP_DB = FILTER_MODE_24_DB - FILTER_MODE_18_DB;

interface SynthPartProps {
  title: string;
  accentColor: 'cyan' | 'pink';
  params: SynthParams;
  onParamsChange: (newParams: SynthParams) => void;
  isFrozen: boolean;
  isRendering: boolean;
  onMixdown: () => void;
  onUnfreeze: () => void;
}

export const SynthPart: React.FC<SynthPartProps> = React.memo(({ title, accentColor, params, onParamsChange, isFrozen, isRendering, onMixdown, onUnfreeze }) => {
  const paramsRef = React.useRef(params);
  React.useEffect(() => {
    paramsRef.current = params;
  }, [params]);

  const handleParamChange = useCallback(<K extends keyof SynthParams>(param: K, value: SynthParams[K]) => {
    onParamsChange({ ...paramsRef.current, [param]: value });
  }, [onParamsChange]);

  const filterModeValue = (params.filterMode ?? 0) > 0 ? FILTER_MODE_24_DB : FILTER_MODE_18_DB;

  const accentClasses = {
    cyan: { border: 'border-cyan-500', text: 'text-cyan-400', knob: 'cyan' as const, ring: 'focus:ring-cyan-400' },
    pink: { border: 'border-pink-500', text: 'text-pink-400', knob: 'pink' as const, ring: 'focus:ring-pink-400' },
  };
  const isDisabled = isFrozen || isRendering;

  const handlers = useMemo(() => {
    return {
      waveform: (val: any) => handleParamChange('waveform', val as any),
      pitch: (val: number) => handleParamChange('pitch', val),
      filterCutoff: (val: number) => handleParamChange('filterCutoff', val),
      filterResonance: (val: number) => handleParamChange('filterResonance', val),
      filterMode: (val: number) => handleParamChange('filterMode', val >= FILTER_MODE_24_DB ? 1 : 0),
      attack: (val: number) => handleParamChange('attack', val),
      decay: (val: number) => handleParamChange('decay', val),
      volume: (val: number) => handleParamChange('volume', val),
      delayTime: (val: number) => handleParamChange('delayTime', val),
      delayFeedback: (val: number) => handleParamChange('delayFeedback', val),
      delayMix: (val: number) => handleParamChange('delayMix', val),
    };
  }, [handleParamChange]);

  return (
    <div className={`relative bg-gray-900/50 p-4 rounded-lg border-2 ${accentClasses[accentColor].border} space-y-4`}>
      <div className="flex justify-between items-start">
        <h2 className={`font-orbitron text-xl font-bold ${accentClasses[accentColor].text}`}>{title}</h2>
        <button
          aria-label={isFrozen ? "Unfreeze Track" : "Mixdown Track"}
          onClick={isFrozen ? onUnfreeze : onMixdown}
          disabled={isRendering}
          aria-busy={isRendering}
          title={isRendering ? 'Rendering audio to track, please wait...' : isFrozen ? 'Unfreeze to edit track parameters (uses more CPU)' : 'Mixdown to freeze track (saves CPU)'}
          className={`px-3 py-1 text-xs font-bold rounded-md transition-colors duration-200 flex items-center gap-1.5 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900 ${accentClasses[accentColor].ring} ${
            isRendering ? 'bg-gray-600 text-gray-400 cursor-wait' :
            isFrozen ? 'bg-yellow-500 hover:bg-yellow-600 text-gray-900' :
            'bg-indigo-500 hover:bg-indigo-600 text-white'
          }`}
        >
          {isRendering && (
            <svg className="animate-spin h-3.5 w-3.5 text-gray-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
          )}
          {isRendering ? 'Rendering...' : isFrozen ? 'Unfreeze' : 'Mixdown'}
        </button>
      </div>
      
      <div className={`relative transition-opacity duration-300 ${isDisabled ? 'opacity-40 pointer-events-none' : ''}`}>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
          <fieldset className="space-y-2 border border-gray-800 rounded p-1">
            <legend className="text-center text-sm uppercase tracking-wider text-gray-400 mx-auto px-1">Oscillator</legend>
            <WaveformSelector selected={params.waveform} onChange={handlers.waveform} accentColor={accentColor} />
            <Knob label="Pitch" value={params.pitch} onChange={handlers.pitch} min={-24} max={24} step={1} color={accentClasses[accentColor].knob} unit="st" />
          </fieldset>
          <fieldset className="space-y-2 border border-gray-800 rounded p-1">
            <legend className="text-center text-sm uppercase tracking-wider text-gray-400 mx-auto px-1">Filter</legend>
            <Knob label="Cutoff" value={params.filterCutoff} onChange={handlers.filterCutoff} min={20} max={15000} color={accentClasses[accentColor].knob} unit="Hz" logarithmic />
            <Knob label="Resonance" value={params.filterResonance} onChange={handlers.filterResonance} min={0.1} max={30} color={accentClasses[accentColor].knob} unit="Q" />
            <Knob label="Mode" value={filterModeValue} onChange={handlers.filterMode} min={FILTER_MODE_18_DB} max={FILTER_MODE_24_DB} step={FILTER_MODE_STEP_DB} color={accentClasses[accentColor].knob} unit="dB" />
          </fieldset>
          <fieldset className="space-y-2 border border-gray-800 rounded p-1">
            <legend className="text-center text-sm uppercase tracking-wider text-gray-400 mx-auto px-1">Envelope</legend>
            <Knob label="Attack" value={params.attack} onChange={handlers.attack} min={0.005} max={2} step={0.001} color={accentClasses[accentColor].knob} unit="s" logarithmic />
            <Knob label="Decay" value={params.decay} onChange={handlers.decay} min={0.01} max={2} step={0.001} color={accentClasses[accentColor].knob} unit="s" logarithmic />
          </fieldset>
          <fieldset className="space-y-2 border border-gray-800 rounded p-1">
            <legend className="text-center text-sm uppercase tracking-wider text-gray-400 mx-auto px-1">Output</legend>
            <Knob label="Volume" value={params.volume} onChange={handlers.volume} min={0} max={1} step={0.01} color={accentClasses[accentColor].knob} />
          </fieldset>
          <fieldset className="space-y-2 border border-gray-800 rounded p-1">
            <legend className="text-center text-sm uppercase tracking-wider text-gray-400 mx-auto px-1">Delay</legend>
            <Knob label="Time" value={params.delayTime} onChange={handlers.delayTime} min={0} max={1} step={0.01} color={accentClasses[accentColor].knob} unit="s" />
            <Knob label="Feedback" value={params.delayFeedback} onChange={handlers.delayFeedback} min={0} max={0.95} step={0.01} color={accentClasses[accentColor].knob} />
            <Knob label="Mix" value={params.delayMix} onChange={handlers.delayMix} min={0} max={1} step={0.01} color={accentClasses[accentColor].knob} />
          </fieldset>
        </div>
      </div>
      {isFrozen && (
        <div className="absolute inset-0 bg-black/30 rounded-lg flex items-center justify-center">
            <span className="font-orbitron text-2xl font-bold text-yellow-400 transform -rotate-12">FROZEN</span>
        </div>
      )}
    </div>
  );
});
