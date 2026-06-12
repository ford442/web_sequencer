
import React, { memo, useCallback, useMemo, useRef, useEffect } from 'react';
import type { AllDrumParams, DrumSound, KickParams, SnareParams, HatParams, DrumKitType } from '../types';
import { Knob } from './Knob';

interface DrumMachineProps {
  params: AllDrumParams;
  onParamsChange: (sound: DrumSound, newParams: KickParams | SnareParams | HatParams) => void;
  /** Currently selected drum kit */
  drumKit?: DrumKitType;
  /** Callback to switch drum kits */
  onDrumKitChange?: (kit: DrumKitType) => void;
}

export const DrumMachine: React.FC<DrumMachineProps> = memo(({ params, onParamsChange, drumKit, onDrumKitChange }) => {
  // Use a ref to access latest params inside callbacks without causing them to update
  const paramsRef = useRef(params);
  useEffect(() => {
    paramsRef.current = params;
  }, [params]);

  const handleParamChange = useCallback(<T extends DrumSound>(sound: T, param: keyof AllDrumParams[T], value: number) => {
    onParamsChange(sound, { ...paramsRef.current[sound], [param]: value } as KickParams | SnareParams | HatParams);
  }, [onParamsChange]);

  // Pre-create callbacks to prevent new function references on every render
  const handlers = useMemo(() => {
    return {
      kick: {
        pitch: (v: number) => handleParamChange('kick', 'pitch', v),
        decay: (v: number) => handleParamChange('kick', 'decay', v),
        tone: (v: number) => handleParamChange('kick', 'tone', v),
        volume: (v: number) => handleParamChange('kick', 'volume', v),
      },
      snare: {
        decay: (v: number) => handleParamChange('snare', 'decay', v),
        tone: (v: number) => handleParamChange('snare', 'tone', v),
        noise: (v: number) => handleParamChange('snare', 'noise', v),
        volume: (v: number) => handleParamChange('snare', 'volume', v),
      },
      hats: {
        chDecay: (v: number) => handleParamChange('closedHat', 'decay', v),
        ohDecay: (v: number) => handleParamChange('openHat', 'decay', v),
        pitch: (v: number) => {
          handleParamChange('closedHat', 'pitch', v);
          handleParamChange('openHat', 'pitch', v);
        },
        volume: (v: number) => {
          handleParamChange('closedHat', 'volume', v);
          handleParamChange('openHat', 'volume', v);
        }
      }
    };
  }, [handleParamChange]);

  return (
    <div className="bg-gray-900/50 p-4 rounded-lg border-2 border-yellow-500 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-orbitron text-xl font-bold text-yellow-400">Drum Machine</h2>
        {onDrumKitChange && (
          <div className="flex items-center gap-2" role="radiogroup" aria-label="Drum Kit Selection">
            <button
              type="button"
              className={`px-3 py-1 rounded text-xs font-bold uppercase tracking-wider transition-colors ${
                drumKit === '808'
                  ? 'bg-yellow-500 text-gray-900 shadow-[0_0_8px_rgba(234,179,8,0.6)] focus:outline-none focus-visible:ring-2 focus-visible:ring-yellow-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900'
                  : 'bg-gray-700 text-gray-400 hover:bg-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-yellow-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900'
              }`}
              onClick={() => onDrumKitChange('808')}
              role="radio"
              aria-checked={drumKit === '808'}
              aria-label="TR-808 Kit"
              title="Switch to TR-808 Kit"
            >
              <span className={`inline-block w-2 h-2 rounded-full mr-1.5 ${drumKit === '808' ? 'bg-red-500 animate-pulse' : 'bg-gray-600'}`} />
              808
            </button>
            <button
              type="button"
              className={`px-3 py-1 rounded text-xs font-bold uppercase tracking-wider transition-colors ${
                drumKit === '909'
                  ? 'bg-yellow-500 text-gray-900 shadow-[0_0_8px_rgba(234,179,8,0.6)] focus:outline-none focus-visible:ring-2 focus-visible:ring-yellow-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900'
                  : 'bg-gray-700 text-gray-400 hover:bg-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-yellow-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900'
              }`}
              onClick={() => onDrumKitChange('909')}
              role="radio"
              aria-checked={drumKit === '909'}
              aria-label="TR-909 Kit"
              title="Switch to TR-909 Kit"
            >
              <span className={`inline-block w-2 h-2 rounded-full mr-1.5 ${drumKit === '909' ? 'bg-blue-500 animate-pulse' : 'bg-gray-600'}`} />
              909
            </button>
          </div>
        )}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* KICK */}
        <fieldset className="space-y-2 p-2 bg-gray-800/50 rounded">
          <legend className="sr-only">Kick</legend>
          <div className="text-center text-sm uppercase tracking-wider text-gray-400 mx-auto px-2 -mt-2 bg-gray-900 w-max" aria-hidden="true">Kick</div>
          <div className="flex justify-around flex-wrap">
            <Knob label="Pitch" value={params.kick.pitch} onChange={handlers.kick.pitch} min={20} max={150} color="yellow" unit="Hz" />
            <Knob label="Decay" value={params.kick.decay} onChange={handlers.kick.decay} min={0.1} max={1.5} step={0.01} color="yellow" unit="s" logarithmic />
            <Knob label="Tone" value={params.kick.tone} onChange={handlers.kick.tone} min={0} max={1} step={0.01} color="yellow" />
            <Knob label="Volume" value={params.kick.volume} onChange={handlers.kick.volume} min={0} max={1.5} step={0.01} color="yellow" />
          </div>
        </fieldset>
        {/* SNARE */}
        <fieldset className="space-y-2 p-2 bg-gray-800/50 rounded">
          <legend className="sr-only">Snare</legend>
          <div className="text-center text-sm uppercase tracking-wider text-gray-400 mx-auto px-2 -mt-2 bg-gray-900 w-max" aria-hidden="true">Snare</div>
          <div className="flex justify-around flex-wrap">
            <Knob label="Decay" value={params.snare.decay} onChange={handlers.snare.decay} min={0.05} max={0.5} step={0.01} color="yellow" unit="s" logarithmic />
            <Knob label="Tone" value={params.snare.tone} onChange={handlers.snare.tone} min={100} max={400} color="yellow" unit="Hz" />
            <Knob label="Noise" value={params.snare.noise} onChange={handlers.snare.noise} min={1000} max={10000} color="yellow" unit="Hz" logarithmic />
            <Knob label="Volume" value={params.snare.volume} onChange={handlers.snare.volume} min={0} max={1.5} step={0.01} color="yellow" />
          </div>
        </fieldset>
        {/* HATS */}
        <fieldset className="space-y-2 p-2 bg-gray-800/50 rounded">
          <legend className="sr-only">Hi-Hats</legend>
          <div className="text-center text-sm uppercase tracking-wider text-gray-400 mx-auto px-2 -mt-2 bg-gray-900 w-max" aria-hidden="true">Hi-Hats</div>
          <div className="flex justify-around flex-wrap">
            <Knob label="CH Decay" value={params.closedHat.decay} onChange={handlers.hats.chDecay} min={0.01} max={0.2} step={0.001} color="yellow" unit="s" logarithmic />
            <Knob label="OH Decay" value={params.openHat.decay} onChange={handlers.hats.ohDecay} min={0.1} max={1.5} step={0.01} color="yellow" unit="s" logarithmic />
            <Knob label="Pitch" value={params.closedHat.pitch} onChange={handlers.hats.pitch} min={3000} max={15000} color="yellow" unit="Hz" logarithmic />
            <Knob label="Volume" value={params.closedHat.volume} onChange={handlers.hats.volume} min={0} max={1.5} step={0.01} color="yellow" />
          </div>
        </fieldset>
      </div>
    </div>
  );
});
