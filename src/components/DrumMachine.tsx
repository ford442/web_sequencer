
import React from 'react';
import type { AllDrumParams, DrumSound, KickParams, SnareParams, HatParams } from '../types';
import { Knob } from './Knob';

interface DrumMachineProps {
  params: AllDrumParams;
  onParamsChange: (sound: DrumSound, newParams: KickParams | SnareParams | HatParams) => void;
}

export const DrumMachine: React.FC<DrumMachineProps> = ({ params, onParamsChange }) => {
  const handleParamChange = <T extends DrumSound>(sound: T, param: keyof AllDrumParams[T], value: number) => {
    onParamsChange(sound, { ...params[sound], [param]: value } as KickParams | SnareParams | HatParams);
  };

  return (
    <div className="bg-gray-900/50 p-4 rounded-lg border-2 border-yellow-500 space-y-4">
      <h2 className="font-orbitron text-xl font-bold text-yellow-400">Drum Machine</h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* KICK */}
        <fieldset className="space-y-2 p-2 bg-gray-800/50 rounded">
          <legend className="text-center text-sm uppercase tracking-wider text-gray-400 mx-auto px-2">Kick</legend>
          <div className="flex justify-around flex-wrap">
            <Knob label="Pitch" value={params.kick.pitch} onChange={v => handleParamChange('kick', 'pitch', v)} min={20} max={150} color="yellow" unit="Hz" />
            <Knob label="Decay" value={params.kick.decay} onChange={v => handleParamChange('kick', 'decay', v)} min={0.1} max={1.5} step={0.01} color="yellow" unit="s" logarithmic />
            <Knob label="Tone" value={params.kick.tone} onChange={v => handleParamChange('kick', 'tone', v)} min={0} max={1} step={0.01} color="yellow" />
            <Knob label="Volume" value={params.kick.volume} onChange={v => handleParamChange('kick', 'volume', v)} min={0} max={1.5} step={0.01} color="yellow" />
          </div>
        </fieldset>
        {/* SNARE */}
        <fieldset className="space-y-2 p-2 bg-gray-800/50 rounded">
          <legend className="text-center text-sm uppercase tracking-wider text-gray-400 mx-auto px-2">Snare</legend>
          <div className="flex justify-around flex-wrap">
            <Knob label="Decay" value={params.snare.decay} onChange={v => handleParamChange('snare', 'decay', v)} min={0.05} max={0.5} step={0.01} color="yellow" unit="s" logarithmic />
            <Knob label="Tone" value={params.snare.tone} onChange={v => handleParamChange('snare', 'tone', v)} min={100} max={400} color="yellow" unit="Hz" />
            <Knob label="Noise" value={params.snare.noise} onChange={v => handleParamChange('snare', 'noise', v)} min={1000} max={10000} color="yellow" unit="Hz" logarithmic />
            <Knob label="Volume" value={params.snare.volume} onChange={v => handleParamChange('snare', 'volume', v)} min={0} max={1.5} step={0.01} color="yellow" />
          </div>
        </fieldset>
        {/* HATS */}
        <fieldset className="space-y-2 p-2 bg-gray-800/50 rounded">
          <legend className="text-center text-sm uppercase tracking-wider text-gray-400 mx-auto px-2">Hi-Hats</legend>
          <div className="flex justify-around flex-wrap">
            <Knob label="CH Decay" value={params.closedHat.decay} onChange={v => handleParamChange('closedHat', 'decay', v)} min={0.01} max={0.2} step={0.001} color="yellow" unit="s" logarithmic />
            <Knob label="OH Decay" value={params.openHat.decay} onChange={v => handleParamChange('openHat', 'decay', v)} min={0.1} max={1.5} step={0.01} color="yellow" unit="s" logarithmic />
            <Knob label="Pitch" value={params.closedHat.pitch} onChange={v => {
                handleParamChange('closedHat', 'pitch', v);
                handleParamChange('openHat', 'pitch', v);
            }} min={3000} max={15000} color="yellow" unit="Hz" logarithmic />
            <Knob label="Volume" value={params.closedHat.volume} onChange={v => {
                handleParamChange('closedHat', 'volume', v);
                handleParamChange('openHat', 'volume', v);
            }} min={0} max={1.5} step={0.01} color="yellow" />
          </div>
        </fieldset>
      </div>
    </div>
  );
};
