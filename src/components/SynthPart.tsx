
import React from 'react';
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

export const SynthPart: React.FC<SynthPartProps> = ({ title, accentColor, params, onParamsChange, isFrozen, isRendering, onMixdown, onUnfreeze }) => {
  const handleParamChange = <K extends keyof SynthParams>(param: K, value: SynthParams[K]) => {
    onParamsChange({ ...params, [param]: value });
  };
  const filterModeValue = (params.filterMode ?? 0) > 0 ? FILTER_MODE_24_DB : FILTER_MODE_18_DB;

  const accentClasses = {
    cyan: { border: 'border-cyan-500', text: 'text-cyan-400', knob: 'cyan' as const, ring: 'focus:ring-cyan-400' },
    pink: { border: 'border-pink-500', text: 'text-pink-400', knob: 'pink' as const, ring: 'focus:ring-pink-400' },
  };
  const isDisabled = isFrozen || isRendering;

  return (
    <div className={`relative bg-gray-900/50 p-4 rounded-lg border-2 ${accentClasses[accentColor].border} space-y-4`}>
      <div className="flex justify-between items-start">
        <h2 className={`font-orbitron text-xl font-bold ${accentClasses[accentColor].text}`}>{title}</h2>
        <button
          onClick={isFrozen ? onUnfreeze : onMixdown}
          disabled={isRendering}
          className={`px-3 py-1 text-xs font-bold rounded-md transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900 ${accentClasses[accentColor].ring} ${
            isRendering ? 'bg-gray-600 text-gray-400 cursor-wait' :
            isFrozen ? 'bg-yellow-500 hover:bg-yellow-600 text-gray-900' :
            'bg-indigo-500 hover:bg-indigo-600 text-white'
          }`}
        >
          {isRendering ? 'Rendering...' : isFrozen ? 'Unfreeze' : 'Mixdown'}
        </button>
      </div>
      
      <div className={`relative transition-opacity duration-300 ${isDisabled ? 'opacity-40 pointer-events-none' : ''}`}>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
          <div className="space-y-2">
            <h3 className="text-center text-sm uppercase tracking-wider text-gray-400">Oscillator</h3>
            <WaveformSelector selected={params.waveform} onChange={(val) => handleParamChange('waveform', val)} accentColor={accentColor} />
            <Knob label="Pitch" value={params.pitch} onChange={(val) => handleParamChange('pitch', val)} min={-24} max={24} step={1} color={accentClasses[accentColor].knob} unit="st" />
          </div>
          <div className="space-y-2">
            <h3 className="text-center text-sm uppercase tracking-wider text-gray-400">Filter</h3>
            <Knob label="Cutoff" value={params.filterCutoff} onChange={(val) => handleParamChange('filterCutoff', val)} min={20} max={15000} color={accentClasses[accentColor].knob} unit="Hz" logarithmic />
            <Knob label="Resonance" value={params.filterResonance} onChange={(val) => handleParamChange('filterResonance', val)} min={0.1} max={30} color={accentClasses[accentColor].knob} unit="Q" />
            <Knob label="Mode" value={filterModeValue} onChange={(val) => handleParamChange('filterMode', val >= FILTER_MODE_24_DB ? 1 : 0)} min={FILTER_MODE_18_DB} max={FILTER_MODE_24_DB} step={FILTER_MODE_STEP_DB} color={accentClasses[accentColor].knob} unit="dB" />
          </div>
          <div className="space-y-2">
            <h3 className="text-center text-sm uppercase tracking-wider text-gray-400">Envelope</h3>
            <Knob label="Attack" value={params.attack} onChange={(val) => handleParamChange('attack', val)} min={0.005} max={2} step={0.001} color={accentClasses[accentColor].knob} unit="s" logarithmic />
            <Knob label="Decay" value={params.decay} onChange={(val) => handleParamChange('decay', val)} min={0.01} max={2} step={0.001} color={accentClasses[accentColor].knob} unit="s" logarithmic />
          </div>
          <div className="space-y-2">
            <h3 className="text-center text-sm uppercase tracking-wider text-gray-400">Output</h3>
            <Knob label="Volume" value={params.volume} onChange={(val) => handleParamChange('volume', val)} min={0} max={1} step={0.01} color={accentClasses[accentColor].knob} />
          </div>
          <div className="space-y-2">
            <h3 className="text-center text-sm uppercase tracking-wider text-gray-400">Delay</h3>
            <Knob label="Time" value={params.delayTime} onChange={(val) => handleParamChange('delayTime', val)} min={0} max={1} step={0.01} color={accentClasses[accentColor].knob} unit="s" />
            <Knob label="Feedback" value={params.delayFeedback} onChange={(val) => handleParamChange('delayFeedback', val)} min={0} max={0.95} step={0.01} color={accentClasses[accentColor].knob} />
            <Knob label="Mix" value={params.delayMix} onChange={(val) => handleParamChange('delayMix', val)} min={0} max={1} step={0.01} color={accentClasses[accentColor].knob} />
          </div>
        </div>
      </div>
      {isFrozen && (
        <div className="absolute inset-0 bg-black/30 rounded-lg flex items-center justify-center">
            <span className="font-orbitron text-2xl font-bold text-yellow-400 transform -rotate-12">FROZEN</span>
        </div>
      )}
    </div>
  );
};
