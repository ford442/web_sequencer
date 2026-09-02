import React from 'react';
import type { SamplerBankParams } from '../../types';
import { Knob } from '../Knob';
import { DrawableLFO } from '../DrawableLFO';

interface SamplerKnobHandlers {
  playbackSpeed: (v: number) => void;
  volume: (v: number) => void;
  filterCutoff: (v: number) => void;
  drive: (v: number) => void;
  timeRatio: (v: number) => void;
  pitchScale: (v: number) => void;
  formantShift: (v: number) => void;
  vibratoDepth: (v: number) => void;
  tremoloDepth: (v: number) => void;
  tremoloRate: (v: number) => void;
  breathIntensity: (v: number) => void;
  freeze: (v: number) => void;
  freezeLfoSync: (v: unknown) => void;
  freezeLfoRate: (v: number) => void;
  freezeLfoDepth: (v: number) => void;
  formantLfoSync: (v: unknown) => void;
  formantLfoRate: (v: number) => void;
  freezeEnvDepth: (v: number) => void;
  timeStretchEnvDepth: (v: number) => void;
  grainLfoRate: (v: number) => void;
  grainLfoDepth: (v: number) => void;
  grainPosLfoDepth: (v: number) => void;
  grainEnvDepth: (v: number) => void;
  grainPitchEnvDepth: (v: number) => void;
  grainJitter: (v: number) => void;
  grainPitchQuantize: (v: number) => void;
  granularPitchShift: (v: number) => void;
  bitcrush: (v: number) => void;
  spectralComp: (v: number) => void;
  downsample: (v: number) => void;
  vocalChorus: (v: number) => void;
  spectralCompression: (v: number) => void;
  windowShape: (v: number) => void;
  customGrainEnvelope: (v: unknown) => void;
  formantLfoDepth: (v: number) => void;
  reverbLfoRate: (v: number) => void;
  reverbLfoDepth: (v: number) => void;
  formantEnvSync: (v: unknown) => void;
  formantSidechainDepth: (v: number) => void;
  customLfoShape: (v: unknown) => void;
  pitchAmount: (v: number) => void;
  pitchAttack: (v: number) => void;
  pitchDecay: (v: number) => void;
  characterMorph: (v: number) => void;
  choir: (v: number) => void;
  glitchChance: (v: number) => void;
  attack: (v: number) => void;
  decay: (v: number) => void;
  sustain: (v: number) => void;
  release: (v: number) => void;
}

interface SamplerKnobControlsProps {
  currentParams: SamplerBankParams;
  handlers: SamplerKnobHandlers;
  onCustomLfoShapeChange: (value: number[]) => void;
  onCustomGrainEnvelopeChange: (value: number[]) => void;
  onMorphTargetChange: (value: string) => void;
  onFormantEnvAttackChange: (v: number) => void;
  onFormantEnvDecayChange: (v: number) => void;
  onFormantEnvAmountChange: (v: number) => void;
  onFormantEnvFollowerChange: (v: number) => void;
  onFormantSidechainDepthChange: (v: number) => void;
}

export const SamplerKnobControls = React.memo(function SamplerKnobControls({
  currentParams,
  handlers,
  onCustomLfoShapeChange,
  onCustomGrainEnvelopeChange,
  onMorphTargetChange,
  onFormantEnvAttackChange,
  onFormantEnvDecayChange,
  onFormantEnvAmountChange,
  onFormantEnvFollowerChange,
  onFormantSidechainDepthChange,
}: SamplerKnobControlsProps) {
  return (
    <div className="flex flex-wrap gap-4 mt-1 pb-4">
      <fieldset className="flex-1 min-w-[140px] bg-gray-800/30 p-2 rounded border-0 m-0">
        <legend className="sr-only">Basic Parameters</legend>
        <div className="text-[9px] text-gray-500 font-bold mb-1 border-b border-gray-700 pb-0.5" aria-hidden="true">BASIC</div>
        <div className="grid grid-cols-2 gap-2">
          <Knob label="Speed" value={currentParams.playbackSpeed || 1} onChange={handlers.playbackSpeed} min={0.1} max={4.0} color="purple" unit="x" />
          <Knob label="Vol" value={currentParams.volume} onChange={handlers.volume} min={0} max={2.0} color="purple" />
          <Knob label="Filter" value={currentParams.filterCutoff} onChange={handlers.filterCutoff} min={100} max={20000} color="purple" logarithmic unit="Hz" />
          <Knob label="Drive" value={currentParams.drive} onChange={handlers.drive} min={0} max={1} color="red" />
        </div>
      </fieldset>

      <fieldset className="flex-[2] min-w-[200px] bg-indigo-900/50 p-2 rounded border-0 m-0">
        <legend className="sr-only">Engine Parameters</legend>
        <div className="text-[9px] text-indigo-300 font-bold mb-1 border-b border-indigo-800 pb-0.5" aria-hidden="true">ENGINE</div>
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-8 gap-2">
          <Knob label="Time" value={currentParams.timeRatio ?? 1} onChange={handlers.timeRatio} min={0.5} max={2.0} step={0.01} color="indigo" unit="x" />
          <Knob label="Pitch" value={currentParams.pitchScale ?? 1} onChange={handlers.pitchScale} min={0.5} max={2.0} step={0.01} color="indigo" unit="x" />
          <Knob label="Formant" value={currentParams.formantShift ?? 0} onChange={handlers.formantShift} min={-12} max={12} step={0.1} color="indigo" />
          <Knob label="Vibrato" value={currentParams.vibratoDepth ?? 0} onChange={handlers.vibratoDepth} min={0} max={100} color="indigo" unit="%" />
          <Knob label="Trem Depth" value={currentParams.tremoloDepth ?? 0} onChange={handlers.tremoloDepth} min={0} max={100} color="indigo" unit="%" />
          <Knob label="Trem Rate" value={currentParams.tremoloRate ?? 0.1} onChange={handlers.tremoloRate} min={0.1} max={20.0} step={0.1} color="indigo" unit="Hz" />
          <Knob label="Breath" value={currentParams.breathIntensity ?? 0} onChange={handlers.breathIntensity} min={0} max={1.0} step={0.01} color="indigo" />
          <Knob label="Freeze" value={currentParams.freeze ?? 0} onChange={handlers.freeze} min={0} max={1.0} step={0.01} color="indigo" unit="%" />

          <div className="flex flex-col items-center gap-1">
            {currentParams.freezeLfoSync ? (
              <div className="flex flex-col items-center min-w-[3rem]">
                <span className="text-xs text-gray-400 uppercase tracking-wider mb-1">Frz Rate</span>
                <select
                  value={currentParams.freezeLfoRate ?? 0}
                  onChange={(e) => handlers.freezeLfoRate(parseFloat(e.target.value))}
                  aria-label="Freeze LFO Rate"
                  className="bg-gray-800 text-indigo-400 text-xs font-mono rounded border border-gray-600 px-1 py-1 text-center cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-indigo-400"
                >
                  <option value={2}>2 Bars</option>
                  <option value={1}>1 Bar</option>
                  <option value={0.5}>1/2</option>
                  <option value={0.25}>1/4</option>
                  <option value={0.125}>1/8</option>
                  <option value={0.0625}>1/16</option>
                </select>
              </div>
            ) : (
              <Knob label="Frz Rate" value={currentParams.freezeLfoRate ?? 0} onChange={handlers.freezeLfoRate} min={0} max={20.0} step={0.1} color="indigo" unit="Hz" />
            )}
            <button
              type="button"
              role="switch"
              aria-checked={currentParams.freezeLfoSync}
              aria-label="Sync Freeze LFO Rate to BPM"
              onClick={() => handlers.freezeLfoSync(!currentParams.freezeLfoSync)}
              className={`px-2 py-0.5 mt-1 rounded text-[10px] font-bold tracking-wider transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${currentParams.freezeLfoSync ? 'bg-indigo-600 text-white' : 'bg-gray-700 text-gray-400 hover:bg-gray-600'}`}
            >
              SYNC
            </button>
          </div>

          <Knob label="Frz LFO Depth" value={currentParams.freezeLfoDepth ?? 0} onChange={handlers.freezeLfoDepth} min={0} max={1.0} step={0.01} color="indigo" unit="%" />

          <div className="flex flex-col items-center gap-1">
            {currentParams.formantLfoSync ? (
              <div className="flex flex-col items-center min-w-[3rem]">
                <span className="text-xs text-gray-400 uppercase tracking-wider mb-1">Fmt Rate</span>
                <select
                  value={currentParams.formantLfoRate ?? 0}
                  onChange={(e) => handlers.formantLfoRate(parseFloat(e.target.value))}
                  aria-label="Formant LFO Rate"
                  className="bg-gray-800 text-indigo-400 text-xs font-mono rounded border border-gray-600 px-1 py-1 text-center cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-indigo-400"
                >
                  <option value={2}>2 Bars</option>
                  <option value={1}>1 Bar</option>
                  <option value={0.5}>1/2</option>
                  <option value={0.25}>1/4</option>
                  <option value={0.125}>1/8</option>
                  <option value={0.0625}>1/16</option>
                </select>
              </div>
            ) : (
              <Knob label="Fmt Rate" value={currentParams.formantLfoRate ?? 0} onChange={handlers.formantLfoRate} min={0} max={20.0} step={0.1} color="indigo" unit="Hz" />
            )}
            <button
              type="button"
              role="switch"
              aria-checked={currentParams.formantLfoSync}
              aria-label="Sync Formant LFO Rate to BPM"
              onClick={() => handlers.formantLfoSync(!currentParams.formantLfoSync)}
              className={`px-2 py-0.5 mt-1 rounded text-[10px] font-bold tracking-wider transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${currentParams.formantLfoSync ? 'bg-indigo-600 text-white' : 'bg-gray-700 text-gray-400 hover:bg-gray-600'}`}
            >
              SYNC
            </button>
          </div>

          <Knob label="Env → Freeze" value={currentParams.freezeEnvDepth || 0} onChange={handlers.freezeEnvDepth} min={0} max={1.0} step={0.01} color="indigo" unit="%" />
          <Knob label="Env → Time" value={currentParams.timeStretchEnvDepth || 0} onChange={handlers.timeStretchEnvDepth} min={-1.0} max={1.0} step={0.01} color="indigo" unit="%" />
          <Knob label="Grain LFO Rate" value={currentParams.grainLfoRate || 0} onChange={handlers.grainLfoRate} min={0} max={20.0} step={0.1} color="indigo" unit="Hz" />
          <Knob label="Grain LFO Depth" value={currentParams.grainLfoDepth || 0} onChange={handlers.grainLfoDepth} min={0} max={1.0} step={0.01} color="indigo" unit="%" />
          <Knob label="Grain Pos Scan" value={currentParams.grainPosLfoDepth || 0} onChange={handlers.grainPosLfoDepth} min={0} max={1.0} step={0.01} color="indigo" unit="%" />
          <Knob label="Env → Grain" value={currentParams.grainEnvDepth || 0} onChange={handlers.grainEnvDepth} min={0} max={1.0} step={0.01} color="indigo" unit="%" />
          <Knob label="Env → Grn Pitch" value={currentParams.grainPitchEnvDepth || 0} onChange={handlers.grainPitchEnvDepth} min={0} max={1.0} step={0.01} color="indigo" unit="%" />
          <Knob label="Jitter" value={currentParams.grainJitter || 0} onChange={handlers.grainJitter} min={0} max={1.0} step={0.01} color="indigo" unit="%" />
          <Knob label="Grain Quant" value={currentParams.grainPitchQuantize || 0} onChange={handlers.grainPitchQuantize} min={0} max={12.0} step={1} color="indigo" unit="st" />
          <Knob label="Gran Pitch" value={currentParams.granularPitchShift || 0} onChange={handlers.granularPitchShift} min={-24} max={24} step={1} color="indigo" unit="st" />
          <Knob label="Chorus" value={currentParams.vocalChorus || 0} onChange={handlers.vocalChorus} min={0} max={1.0} step={0.01} color="indigo" unit="%" />
          <Knob label="Bitcrush" value={currentParams.bitcrush || 0} onChange={handlers.bitcrush} min={0} max={1.0} step={0.01} color="indigo" unit="%" />
          <Knob label="Spectral Comp" value={currentParams.spectralComp || 0} onChange={handlers.spectralComp} min={0} max={1.0} step={0.01} color="indigo" unit="%" />
          <Knob label="Downsample" value={currentParams.downsample || 1} onChange={handlers.downsample} min={1} max={32} step={1} color="indigo" unit="x" />
          <Knob label="Band Dyn" value={currentParams.spectralCompression || 0} onChange={handlers.spectralCompression} min={0} max={1.0} step={0.01} color="indigo" unit="%" />
          <Knob label="Fmt LFO Rate" value={currentParams.formantLfoRate ?? 0} onChange={handlers.formantLfoRate} min={0} max={20.0} step={0.1} color="indigo" unit="Hz" />
          <Knob label="Fmt LFO Depth" value={currentParams.formantLfoDepth ?? 0} onChange={handlers.formantLfoDepth} min={0} max={1.0} step={0.01} color="indigo" unit="%" />
          <Knob label="Reverb LFO Rate" value={currentParams.reverbLfoRate ?? 0.1} onChange={handlers.reverbLfoRate} min={0.1} max={10.0} step={0.1} color="indigo" unit="Hz" />
          <Knob label="Reverb LFO Depth" value={currentParams.reverbLfoDepth ?? 0} onChange={handlers.reverbLfoDepth} min={0} max={1.0} step={0.01} color="indigo" unit="%" />

          <fieldset className="p-2 border border-purple-500/20 rounded bg-black/40">
            <legend className="text-[10px] text-purple-400 font-mono tracking-wider mb-2 px-1">Pitch Envelope</legend>
            <div className="flex items-center gap-4">
              <Knob label="Amount" value={currentParams.pitchAmount ?? 0} onChange={handlers.pitchAmount} min={-24} max={24} step={0.1} color="purple" unit="st" />
              <Knob label="Attack" value={currentParams.pitchAttack ?? 0} onChange={handlers.pitchAttack} min={0} max={1.0} step={0.01} color="purple" />
              <Knob label="Decay" value={currentParams.pitchDecay ?? 0} onChange={handlers.pitchDecay} min={0} max={1.0} step={0.01} color="purple" />
            </div>
          </fieldset>

          <fieldset className="flex items-start gap-1 col-span-2 border border-indigo-900/30 p-1 rounded bg-gray-800/20">
            <legend className="sr-only">Formant Envelope</legend>
            <div className="flex flex-col items-center gap-1 min-w-[3rem] justify-center mt-4 border-r border-indigo-900/50 pr-1">
              <button
                type="button"
                role="switch"
                aria-checked={currentParams.formantEnvSync || false}
                aria-label="Sync Formant Envelope to BPM"
                onClick={() => handlers.formantEnvSync(!currentParams.formantEnvSync)}
                className={`px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${currentParams.formantEnvSync ? 'bg-indigo-600 text-white' : 'bg-gray-700 text-gray-400 hover:bg-gray-600'}`}
              >
                SYNC
              </button>
            </div>
            <div className="flex gap-1">
              {currentParams.formantEnvSync ? (
                <div className="flex flex-col items-center min-w-[3rem]">
                  <span className="text-xs text-gray-400 uppercase tracking-wider mb-1">Fmt Atk</span>
                  <select
                    value={currentParams.formantEnvAttack ?? 0.1}
                    onChange={(e) => onFormantEnvAttackChange(parseFloat(e.target.value))}
                    aria-label="Formant Envelope Attack Subdivision"
                    className="w-full bg-gray-800 text-indigo-400 text-xs font-mono rounded border border-indigo-900/30 px-1 py-1 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-indigo-400 hover:bg-gray-700 transition-colors"
                  >
                    <option value={2}>2 Bars</option>
                    <option value={1}>1 Bar</option>
                    <option value={0.5}>1/2</option>
                    <option value={0.25}>1/4</option>
                    <option value={0.125}>1/8</option>
                    <option value={0.0625}>1/16</option>
                  </select>
                </div>
              ) : (
                <Knob label="Fmt Env Atk" value={currentParams.formantEnvAttack ?? 0.1} onChange={onFormantEnvAttackChange} min={0.01} max={5.0} step={0.01} color="indigo" unit="s" />
              )}
              {currentParams.formantEnvSync ? (
                <div className="flex flex-col items-center min-w-[3rem]">
                  <span className="text-xs text-gray-400 uppercase tracking-wider mb-1">Fmt Dec</span>
                  <select
                    value={currentParams.formantEnvDecay ?? 0.5}
                    onChange={(e) => onFormantEnvDecayChange(parseFloat(e.target.value))}
                    aria-label="Formant Envelope Decay Subdivision"
                    className="w-full bg-gray-800 text-indigo-400 text-xs font-mono rounded border border-indigo-900/30 px-1 py-1 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-indigo-400 hover:bg-gray-700 transition-colors"
                  >
                    <option value={2}>2 Bars</option>
                    <option value={1}>1 Bar</option>
                    <option value={0.5}>1/2</option>
                    <option value={0.25}>1/4</option>
                    <option value={0.125}>1/8</option>
                    <option value={0.0625}>1/16</option>
                  </select>
                </div>
              ) : (
                <Knob label="Fmt Env Dec" value={currentParams.formantEnvDecay ?? 0.5} onChange={onFormantEnvDecayChange} min={0.01} max={5.0} step={0.01} color="indigo" unit="s" />
              )}
              <Knob label="Fmt Env Amt" value={currentParams.formantEnvAmount ?? 0} onChange={onFormantEnvAmountChange} min={-24} max={24} step={1} color="indigo" unit="st" />
              <Knob label="Fmt Follower" value={currentParams.formantEnvFollower ?? 0} onChange={onFormantEnvFollowerChange} min={-24} max={24} step={1} color="indigo" unit="st" />
              <Knob label="Fmt Ducking" value={currentParams.formantSidechainDepth ?? 0} onChange={onFormantSidechainDepthChange} min={0} max={24} step={1} color="indigo" unit="st" />
          <div className="flex flex-col items-center justify-start gap-1">
            <div className="text-[8px] text-gray-400 font-bold mb-0.5">WNDW SHAPE</div>
            <select
              value={currentParams.windowShape ?? 0}
              onChange={(e) => handlers.windowShape(parseFloat(e.target.value))}
              aria-label="Granular Window Shape"
              className="w-[50px] bg-indigo-950 text-[8px] text-indigo-300 border border-indigo-700 rounded px-0.5 py-0.5 outline-none focus:border-indigo-400 mt-1"
            >
              <option value={0}>Hann</option>
              <option value={1}>Hamming</option>
              <option value={2}>Blackman</option>
              <option value={3}>None</option>
            </select>
          </div>
          <div className="flex flex-col items-center justify-start gap-1 col-span-2">
            <div className="text-[9px] text-indigo-300 font-bold mb-0.5">GRAIN ENV</div>
            <DrawableLFO
              resolution={64}
              value={currentParams.customGrainEnvelope || Array(64).fill(0.5)}
              onChange={onCustomGrainEnvelopeChange}
              width={120}
              height={40}
              color="#22d3ee"
            />
          </div>
            </div>
          </fieldset>

          <div className="flex flex-col items-center justify-start gap-1 col-span-2">
            <div className="text-[9px] text-indigo-300 font-bold mb-0.5">CUSTOM LFO SHAPE</div>
            <DrawableLFO
              resolution={64}
              value={currentParams.customLfoShape || Array(64).fill(0.5)}
              onChange={onCustomLfoShapeChange}
              width={120}
              height={40}
            />
          </div>

          <div className="flex flex-col justify-end">
            <DrawableLFO
              value={currentParams.customLfoShape}
              onChange={handlers.customLfoShape}
              label="Fmt LFO Shape"
            />
          </div>

          <div className="flex flex-col items-center justify-start gap-1">
            <Knob label="Morph" value={currentParams.characterMorph ?? 0} onChange={handlers.characterMorph} min={0} max={1.0} step={0.01} color="indigo" unit="%" />
            <select
              value={currentParams.morphTarget ?? 'female'}
              onChange={(e) => onMorphTargetChange(e.target.value)}
              aria-label="Morph Target Character"
              className="w-[50px] bg-indigo-950 text-[8px] text-indigo-300 border border-indigo-700 rounded px-0.5 py-0.5 outline-none focus:border-indigo-400 mt-1"
              title="Morph Target Character"
            >
              <option value="male">Male</option>
              <option value="female">Female</option>
              <option value="child">Child</option>
              <option value="deep">Deep</option>
              <option value="bright">Bright</option>
            </select>
          </div>

          <Knob label="Choir" value={currentParams.choir ?? 0} onChange={handlers.choir} min={0} max={1.0} step={0.01} color="indigo" />
          <Knob label="Glitch" value={currentParams.glitchChance ?? 0} onChange={handlers.glitchChance} min={0} max={1.0} step={0.01} color="indigo" unit="%" />
          <Knob label="Attack" value={currentParams.attack ?? 0.05} onChange={handlers.attack} min={0.001} max={2.0} step={0.01} color="indigo" unit="s" />
          <Knob label="Decay" value={currentParams.decay ?? 0.1} onChange={handlers.decay} min={0.001} max={2.0} step={0.01} color="indigo" unit="s" />
          <Knob label="Sustain" value={currentParams.sustain ?? 1.0} onChange={handlers.sustain} min={0} max={1.0} step={0.01} color="indigo" />
          <Knob label="Release" value={currentParams.release ?? 0.1} onChange={handlers.release} min={0.001} max={5.0} step={0.01} color="indigo" unit="s" />
        </div>
      </fieldset>
    </div>
  );
});
