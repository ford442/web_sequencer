
import React, { useCallback, useMemo } from 'react';
import type { AllDrumParams, DrumSound, KickParams, SnareParams, HatParams } from '../types';
import { Knob } from './Knob';

interface DrumMachineProps {
  params: AllDrumParams;
  onParamsChange: (sound: DrumSound, newParams: KickParams | SnareParams | HatParams) => void;
}

export const DrumMachine: React.FC<DrumMachineProps> = React.memo(({ params, onParamsChange }) => {
  // Use a ref to access latest params inside callbacks without causing them to update
  const paramsRef = React.useRef(params);
  React.useEffect(() => {
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
        pitchDecay: (v: number) => handleParamChange('kick', 'pitchDecay', v),
        tone: (v: number) => handleParamChange('kick', 'tone', v),
        volume: (v: number) => handleParamChange('kick', 'volume', v),
      },
      snare: {
        pitchDecay: (v: number) => handleParamChange('snare', 'pitchDecay', v),
        tone: (v: number) => handleParamChange('snare', 'tone', v),
        noise: (v: number) => handleParamChange('snare', 'noise', v),
        volume: (v: number) => handleParamChange('snare', 'volume', v),
      },
      hats: {
        chDecay: (v: number) => handleParamChange('closedHat', 'pitchDecay', v),
        ohDecay: (v: number) => handleParamChange('openHat', 'pitchDecay', v),
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
      <h2 className="font-orbitron text-xl font-bold text-yellow-400">Drum Machine</h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* KICK */}
        <fieldset className="space-y-2 p-2 bg-gray-800/50 rounded">
          <legend className="text-center text-sm uppercase tracking-wider text-gray-400 mx-auto px-2">Kick</legend>
          <div className="flex justify-around flex-wrap">
            <Knob label="Pitch" value={params.kick.pitch} onChange={handlers.kick.pitch} min={20} max={150} color="yellow" unit="Hz" />
            <Knob label="Decay" value={params.kick.pitchDecay} onChange={handlers.kick.pitchDecay} min={0.1} max={1.5} step={0.01} color="yellow" unit="s" logarithmic />
            <Knob label="Tone" value={params.kick.tone} onChange={handlers.kick.tone} min={0} max={1} step={0.01} color="yellow" />
            <Knob label="Volume" value={params.kick.volume} onChange={handlers.kick.volume} min={0} max={1.5} step={0.01} color="yellow" />
          </div>
        </fieldset>
        {/* SNARE */}
        <fieldset className="space-y-2 p-2 bg-gray-800/50 rounded">
          <legend className="text-center text-sm uppercase tracking-wider text-gray-400 mx-auto px-2">Snare</legend>
          <div className="flex justify-around flex-wrap">
            <Knob label="Decay" value={params.snare.pitchDecay} onChange={handlers.snare.pitchDecay} min={0.05} max={0.5} step={0.01} color="yellow" unit="s" logarithmic />
            <Knob label="Tone" value={params.snare.tone} onChange={handlers.snare.tone} min={100} max={400} color="yellow" unit="Hz" />
            <Knob label="Noise" value={params.snare.noise} onChange={handlers.snare.noise} min={1000} max={10000} color="yellow" unit="Hz" logarithmic />
            <Knob label="Volume" value={params.snare.volume} onChange={handlers.snare.volume} min={0} max={1.5} step={0.01} color="yellow" />
          </div>
        </fieldset>
        {/* HATS */}
        <fieldset className="space-y-2 p-2 bg-gray-800/50 rounded">
          <legend className="text-center text-sm uppercase tracking-wider text-gray-400 mx-auto px-2">Hi-Hats</legend>
          <div className="flex justify-around flex-wrap">
            <Knob label="CH Decay" value={params.closedHat.pitchDecay} onChange={handlers.hats.chDecay} min={0.01} max={0.2} step={0.001} color="yellow" unit="s" logarithmic />
            <Knob label="OH Decay" value={params.openHat.pitchDecay} onChange={handlers.hats.ohDecay} min={0.1} max={1.5} step={0.01} color="yellow" unit="s" logarithmic />
            <Knob label="Pitch" value={params.closedHat.pitch} onChange={handlers.hats.pitch} min={3000} max={15000} color="yellow" unit="Hz" logarithmic />
            <Knob label="Volume" value={params.closedHat.volume} onChange={handlers.hats.volume} min={0} max={1.5} step={0.01} color="yellow" />
          </div>
        </fieldset>
      </div>
    </div>
  );
});
