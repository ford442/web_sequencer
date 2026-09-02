import React from "react";
import { PropertySlider } from "./PropertySlider";
import { VocoderProperties } from "./VocoderProperties";
import { DrawableLFO } from "../DrawableLFO";
import type { SynthEffectPropertiesProps } from "./synthEffectTypes";

export const SynthGranularEffects: React.FC<SynthEffectPropertiesProps> = React.memo((props) => {
  const {
    trackType,
    onPropertyChange,
    isProphecy = false,
    currentFreeze = 0,
    currentFreezeLfoSync = false,
    currentFreezeLfoRate = 0,
    currentFreezeLfoDepth = 0,
    currentFreezeEnvDepth = 0,
    currentGrainLfoRate = 0,
    currentGrainLfoDepth = 0,
    currentGrainEnvDepth = 0,
    currentGrainPitchEnvDepth = 0,
    currentGrainJitter = 0,
    currentGrainPitchQuantize = 0,
    currentGranularPitchShift = 0,
    currentWindowShape,
    currentCustomGrainEnvelope,
    currentVocoderMix,
    currentVocoderFormantShift,
    currentVocoderPreservation,
    currentBitcrush = 0,
    currentSpectralComp = 0,
    currentSubHarmonics = 0,
    currentDownsample = 1,
    currentSpectralCompression = 0,
    currentTranceGate = 0,
    currentFormantShift,
    currentSlideFormant = false,
    currentFormantLfoSync,
    currentFormantLfoRate = 0,
    currentFormantLfoDepth = 0,
    currentTremoloRate = 0,
    currentTremoloDepth = 0,
    currentPitchAmount = 0,
    currentPitchAttack = 0,
    currentPitchDecay = 0,
    currentFormantEnvSync,
    currentFormantEnvAttack = 0.1,
    currentFormantEnvDecay = 0.5,
    currentFormantEnvAmount = 0,
    currentFormantEnvFollower = 0,
    currentDrive,
    currentVibratoDepth = 0,
    currentVolumeFilterMod = 0,
    currentCustomWindowShape,
    currentVowel = 0,
    currentPortamento = 0,
    currentCharacterMorph = 0,
    currentFilterCutoff,
    currentFilterResonance,
    currentEnvMod,
    currentRetrigger = 1,
    currentTimeStretchEnvDepth = 0,
    currentSpectralPanRate = 0,
    currentSpectralPanDepth = 0,
    currentReverse = false,
  } = props;

  if (trackType !== "synth") return null;

  return (
    <>
      <div className="flex flex-col gap-1">
        <div className="flex justify-between text-[10px] text-cyan-200/70 font-bold uppercase">
          <label htmlFor="note-freeze">Freeze</label>
          <span className="text-cyan-400 font-mono text-[10px] drop-shadow-[0_0_5px_rgba(34,211,238,0.5)]">
            {Math.round((currentFreeze + 0.0001) * 100)}%
          </span>
        </div>
        <input
          id="note-freeze"
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={currentFreeze}
          onChange={(e) =>
            onPropertyChange?.("freeze", parseFloat(e.target.value))
          }
          className="w-full h-2 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-cyan-400 border border-cyan-900/30 hover:accent-cyan-300 transition-all"
          aria-valuetext={`\${Math.round((currentFreeze + 0.0001) * 100)}%`}
          aria-label="Freeze"
        />
      </div>
       <div className="flex flex-col gap-1 mt-2 p-2 bg-gray-800/40 rounded border border-cyan-900/30">
        <div className="flex justify-between items-center text-[10px] text-cyan-200/70 font-bold uppercase mb-1">
          <label htmlFor="note-freeze-rate">Frz LFO Rate</label>
          <div className="flex items-center gap-2">
            <button type="button"
              role="switch"
              aria-checked={currentFreezeLfoSync}
              aria-label="Sync Freeze LFO Rate to BPM"
              onClick={() =>
                onPropertyChange?.(
                  "freezeLfoSync",
                  !currentFreezeLfoSync,
                )
              }
              className={`px-1.5 py-0.5 rounded text-[8px] font-bold tracking-wider transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-cyan-400 ${currentFreezeLfoSync ? "bg-cyan-600 text-white" : "bg-gray-700 text-gray-400 hover:bg-gray-600"}`}
            >
              SYNC
            </button>
            {!currentFreezeLfoSync && (
              <span className="text-cyan-400 font-mono text-[10px] drop-shadow-[0_0_5px_rgba(34,211,238,0.5)]">
                {currentFreezeLfoRate.toFixed(1)} Hz
              </span>
            )}
          </div>
        </div>
        {currentFreezeLfoSync ? (
          <select
            id="note-freeze-rate-sync"
            value={currentFreezeLfoRate}
            onChange={(e) =>
              onPropertyChange?.(
                "freezeLfoRate",
                parseFloat(e.target.value),
              )
            }
            aria-label="Freeze LFO Rate (Synced)"
            className="w-full bg-gray-900 text-cyan-400 text-xs font-mono rounded border border-cyan-900/50 px-2 py-1 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-cyan-400"
          >
            <option value={2}>2 Bars</option>
            <option value={1}>1 Bar</option>
            <option value={0.5}>1/2</option>
            <option value={0.25}>1/4</option>
            <option value={0.125}>1/8</option>
            <option value={0.0625}>1/16</option>
          </select>
        ) : (
          <input
            id="note-freeze-rate"
            type="range"
            min="0"
            max="20"
            step="0.1"
            value={currentFreezeLfoRate}
            onChange={(e) =>
              onPropertyChange?.(
                "freezeLfoRate",
                parseFloat(e.target.value),
              )
            }
            className="w-full h-2 bg-gray-900 rounded-lg appearance-none cursor-pointer accent-cyan-400 border border-cyan-900/30 hover:accent-cyan-300 transition-all"
            aria-valuetext={`${currentFreezeLfoRate.toFixed(1)} Hz`}
            aria-label="Freeze LFO Rate"
          />
        )}
      </div>
       <div className="flex flex-col gap-1">
        <div className="flex justify-between text-[10px] text-cyan-200/70 font-bold uppercase">
          <label htmlFor="note-freeze-depth">Frz LFO Depth</label>
          <span className="text-cyan-400 font-mono text-[10px] drop-shadow-[0_0_5px_rgba(34,211,238,0.5)]">
            {Math.round((currentFreezeLfoDepth + 0.0001) * 100)}%
          </span>
        </div>
        <input
          id="note-freeze-depth"
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={currentFreezeLfoDepth}
          onChange={(e) =>
            onPropertyChange?.(
              "freezeLfoDepth",
              parseFloat(e.target.value),
            )
          }
          className="w-full h-2 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-cyan-400 border border-cyan-900/30 hover:accent-cyan-300 transition-all"
          aria-valuetext={`${Math.round((currentFreezeLfoDepth + 0.0001) * 100)}%`}
          aria-label="Freeze LFO Depth"
        />
      </div>
       <div className="flex flex-col gap-1">
        <div className="flex justify-between text-[10px] text-cyan-200/70 font-bold uppercase">
          <label htmlFor="note-freeze-env">Env Frz</label>
          <span className="text-cyan-400 font-mono text-[10px] drop-shadow-[0_0_5px_rgba(34,211,238,0.5)]">
            {Math.round((currentFreezeEnvDepth + 0.0001) * 100)}%
          </span>
        </div>
        <input
          id="note-freeze-env"
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={currentFreezeEnvDepth}
          onChange={(e) =>
            onPropertyChange?.(
              "freezeEnvDepth",
              parseFloat(e.target.value),
            )
          }
          className="w-full h-2 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-cyan-400 border border-cyan-900/30 hover:accent-cyan-300 transition-all"
          aria-valuetext={`\${Math.round((currentFreezeEnvDepth + 0.0001) * 100)}%`}
          aria-label="Envelope to Freeze Depth"
        />
      </div>
       <div className="flex flex-col gap-1">
        <div className="flex justify-between text-[10px] text-cyan-200/70 font-bold uppercase">
          <label htmlFor="note-grain-env">Env Grn</label>
          <span className="text-cyan-400 font-mono text-[10px] drop-shadow-[0_0_5px_rgba(34,211,238,0.5)]">
            {Math.round((currentGrainEnvDepth + 0.0001) * 100)}%
          </span>
        </div>
        <input
          id="note-grain-env"
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={currentGrainEnvDepth}
          onChange={(e) =>
            onPropertyChange?.(
              "grainEnvDepth",
              parseFloat(e.target.value),
            )
          }
          className="w-full h-2 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-cyan-400 border border-cyan-900/30 hover:accent-cyan-300 transition-all"
          aria-valuetext={`\${Math.round((currentGrainEnvDepth + 0.0001) * 100)}%`}
          aria-label="Envelope to Grain Size Depth"
        />
      </div>
      <div className="flex flex-col gap-1">
        <div className="flex justify-between text-[10px] text-cyan-200/70 font-bold uppercase">
          <label htmlFor="note-grain-lfo-rate">Grain LFO Rate</label>
          <span className="text-cyan-400 font-mono text-[10px] drop-shadow-[0_0_5px_rgba(34,211,238,0.5)]">
            {currentGrainLfoRate.toFixed(1)} Hz
          </span>
        </div>
        <input
          id="note-grain-lfo-rate"
          type="range"
          min="0"
          max="20"
          step="0.1"
          value={currentGrainLfoRate}
          onChange={(e) =>
            onPropertyChange?.(
              "grainLfoRate",
              parseFloat(e.target.value)
            )
          }
          className="w-full h-2 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-cyan-400 border border-cyan-900/30 hover:accent-cyan-300 transition-all"
          aria-valuetext={`${currentGrainLfoRate.toFixed(1)} Hz`}
          aria-label="Grain Size LFO Rate"
        />
      </div>
      <div className="flex flex-col gap-1">
        <div className="flex justify-between text-[10px] text-cyan-200/70 font-bold uppercase">
          <label htmlFor="note-grain-lfo-depth">Grain LFO Depth</label>
          <span className="text-cyan-400 font-mono text-[10px] drop-shadow-[0_0_5px_rgba(34,211,238,0.5)]">
            {Math.round((currentGrainLfoDepth + 0.0001) * 100)}%
          </span>
        </div>
        <input
          id="note-grain-lfo-depth"
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={currentGrainLfoDepth}
          onChange={(e) =>
            onPropertyChange?.(
              "grainLfoDepth",
              parseFloat(e.target.value)
            )
          }
          className="w-full h-2 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-cyan-400 border border-cyan-900/30 hover:accent-cyan-300 transition-all"
          aria-valuetext={`${Math.round((currentGrainLfoDepth + 0.0001) * 100)}%`}
          aria-label="Grain Size LFO Depth"
        />
      </div>
       <div className="flex flex-col gap-1">
        <div className="flex justify-between text-[10px] text-cyan-200/70 font-bold uppercase">
          <label htmlFor="note-grain-jitter">Grain Jitter</label>
          <span className="text-cyan-400 font-mono text-[10px] drop-shadow-[0_0_5px_rgba(34,211,238,0.5)]">
            {Math.round((currentGrainJitter + 0.0001) * 100)}%
          </span>
        </div>
        <input
          id="note-grain-jitter"
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={currentGrainJitter}
          onChange={(e) =>
            onPropertyChange?.(
              "grainJitter",
              parseFloat(e.target.value),
            )
          }
          className="w-full h-2 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-cyan-400 border border-cyan-900/30 hover:accent-cyan-300 transition-all"
          aria-valuetext={`\${Math.round((currentGrainJitter + 0.0001) * 100)}%`}
          aria-label="Envelope to Grain Jitter Amount"
        />
      </div>
       <div className="flex flex-col gap-1">
        <div className="flex justify-between text-[10px] text-cyan-200/70 font-bold uppercase">
          <label htmlFor="note-grain-pitch-env">
            Grain Pitch Env
          </label>
          <span className="text-cyan-400 font-mono text-[10px] drop-shadow-[0_0_5px_rgba(34,211,238,0.5)]">
            {Math.round((currentGrainPitchEnvDepth + 0.0001) * 100)}
            %
          </span>
        </div>
        <input
          id="note-grain-pitch-env"
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={currentGrainPitchEnvDepth}
          onChange={(e) =>
            onPropertyChange?.(
              "grainPitchEnvDepth",
              parseFloat(e.target.value)
            )
          }
          className="w-full h-2 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-cyan-400 border border-cyan-900/30 hover:accent-cyan-300 transition-all"
          aria-valuetext={`${Math.round((currentGrainPitchEnvDepth + 0.0001) * 100)}%`}
          aria-label="Granular Pitch Envelope Depth"
        />
      </div>
       <div className="flex flex-col gap-1">
        <div className="flex justify-between text-[10px] text-cyan-200/70 font-bold uppercase">
          <label htmlFor="note-grain-quant">Grain Quant</label>
          <span className="text-cyan-400 font-mono text-[10px] drop-shadow-[0_0_5px_rgba(34,211,238,0.5)]">
            {currentGrainPitchQuantize} st
          </span>
        </div>
        <input
          id="note-grain-quant"
          type="range"
          min="0"
          max="12"
          step="1"
          value={currentGrainPitchQuantize}
          onChange={(e) =>
            onPropertyChange?.(
              "grainPitchQuantize",
              parseFloat(e.target.value),
            )
          }
          className="w-full h-2 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-cyan-400 border border-cyan-900/30 hover:accent-cyan-300 transition-all"
          aria-valuetext={`${currentGrainPitchQuantize} semitones`}
          aria-label="Granular Pitch Quantization"
        />{" "}
      </div>
      <div className="flex flex-col gap-1">
        <div className="flex justify-between text-[10px] text-cyan-200/70 font-bold uppercase">
          <label htmlFor="note-spectral-compression">Band Dyn</label>
          <span className="text-cyan-400 font-mono text-[10px] drop-shadow-[0_0_5px_rgba(34,211,238,0.5)]">
            {Math.round((currentSpectralCompression + 0.0001) * 100)}%
          </span>
        </div>
        <input
          id="note-spectral-compression"
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={currentSpectralCompression}
          onChange={(e) =>
            onPropertyChange?.(
              "spectralCompression",
              parseFloat(e.target.value),
            )
          }
          className="w-full h-2 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-cyan-400 border border-cyan-900/30 hover:accent-cyan-300 transition-all"
          aria-valuetext={`${Math.round((currentSpectralCompression + 0.0001) * 100)}%`}
          aria-label="Spectral Compression Amount"
        />
      </div>
       <div className="flex flex-col gap-1">
        <div className="flex justify-between text-[10px] text-cyan-200/70 font-bold uppercase">
          <label htmlFor="note-gran-pitch">Gran Pitch Shift</label>
          <span className="text-cyan-400 font-mono text-[10px] drop-shadow-[0_0_5px_rgba(34,211,238,0.5)]">
            {currentGranularPitchShift ?? 0} st
          </span>
        </div>
        <input
          id="note-gran-pitch"
          type="range"
          min="-24"
          max="24"
          step="1"
          value={currentGranularPitchShift ?? 0}
          onChange={(e) =>
            onPropertyChange?.(
              "granularPitchShift",
              parseFloat(e.target.value),
            )
          }
          className="w-full h-2 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-cyan-400 border border-cyan-900/30 hover:accent-cyan-300 transition-all"
          aria-valuetext={`${currentGranularPitchShift ?? 0} semitones`}
          aria-label="Granular Pitch Shift Override"
        />
      </div>
       <div className="flex flex-col gap-1">
        <div className="flex justify-between text-[10px] text-cyan-200/70 font-bold uppercase">
          <label htmlFor="note-window-shape">Window Shape</label>
        </div>
        <select
          id="note-window-shape"
          value={currentWindowShape ?? 0}
          onChange={(e) =>
            onPropertyChange?.(
              "windowShape",
              parseFloat(e.target.value)
            )
          }
          className="w-full bg-gray-900 border border-cyan-900/30 text-cyan-300 text-[10px] rounded px-1 py-0.5 outline-none focus-visible:border-cyan-400"
          aria-label="Granular Window Shape"
        >
          <option value={0}>Hann</option>
          <option value={1}>Hamming</option>
          <option value={2}>Blackman</option>
          <option value={3}>Rectangular (None)</option>
        </select>
      </div>
      <div className="flex flex-col items-center justify-start gap-1 col-span-2 mt-2">
        <div className="text-[10px] text-cyan-200/70 font-bold uppercase w-full flex justify-between">
          <span>Custom Grain Envelope</span>
        </div>
        <div className="w-full flex justify-center bg-gray-900 rounded-lg p-1 border border-cyan-900/30">
          <DrawableLFO
            resolution={64}
            value={currentCustomGrainEnvelope || Array(64).fill(0.5)}
            onChange={(v) => onPropertyChange?.("customGrainEnvelope", v)}
            width={160}
            height={40}
            color="#22d3ee"
          />
        </div>
      </div>
      <VocoderProperties
        onPropertyChange={onPropertyChange}
        currentVocoderMix={currentVocoderMix}
        currentVocoderFormantShift={currentVocoderFormantShift}
        currentVocoderPreservation={currentVocoderPreservation}
      />
      <PropertySlider
        label="Bitcrush"
        id="note-bitcrush"
        ariaLabel="Bitcrush Override"
        value={currentBitcrush ?? 0}
        onChange={(v) => onPropertyChange?.("bitcrush", v)}
        valueFormatter={() =>
          `${((currentBitcrush ?? 0) * 100).toFixed(0)}%`
        }
        accentColor="accent-indigo-400 hover:accent-indigo-300"
        borderColor="border-indigo-900/30"
      />
      <PropertySlider
        label="Spectral Comp"
        id="note-spectral-comp"
        ariaLabel="Spectral Comp Override"
        value={currentSpectralComp ?? 0}
        onChange={(v) => onPropertyChange?.("spectralComp", v)}
        valueFormatter={() =>
          `${((currentSpectralComp ?? 0) * 100).toFixed(0)}%`
        }
        accentColor="accent-indigo-400 hover:accent-indigo-300"
        borderColor="border-indigo-900/30"
      />
      <PropertySlider
        label="Syllable Filter"
        id="note-vol-filter-mod"
        ariaLabel="Syllable Filter Amount Override"
        value={currentVolumeFilterMod ?? 0}
        onChange={(v) => onPropertyChange?.("volumeFilterMod", v)}
        valueFormatter={() =>
          `${((currentVolumeFilterMod ?? 0) * 100).toFixed(0)}%`
        }
        accentColor="accent-indigo-400 hover:accent-indigo-300"
        borderColor="border-indigo-900/30"
      />
      <PropertySlider
        label="Sub Bass"
        id="note-sub-harmonics"
        ariaLabel="Sub Bass Amount"
        value={currentSubHarmonics ?? 0}
        onChange={(v) => onPropertyChange?.("subHarmonics", v)}
        valueFormatter={() =>
          `${((currentSubHarmonics ?? 0) * 100).toFixed(0)}%`
        }
        accentColor="accent-indigo-400 hover:accent-indigo-300"
        borderColor="border-indigo-900/30"
      />
       <PropertySlider
        label="Downsample"
        id="note-downsample"
        ariaLabel="Downsample Override"
        min={1}
        max={32}
        step={1}
        value={currentDownsample ?? 1}
        onChange={(v) => onPropertyChange?.("downsample", v)}
        valueFormatter={() => `${currentDownsample ?? 1}x`}
        accentColor="accent-indigo-400 hover:accent-indigo-300"
        borderColor="border-indigo-900/30"
      />
       <div className="flex flex-col gap-1">
        <div className="flex justify-between text-[10px] text-cyan-200/70 font-bold uppercase">
          <label htmlFor="note-trance-gate">Gate</label>
          <span className="text-cyan-400 font-mono text-[10px] drop-shadow-[0_0_5px_rgba(34,211,238,0.5)]">
            {Math.round((currentTranceGate + 0.0001) * 100)}%
          </span>
        </div>
        <input
          id="note-trance-gate"
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={currentTranceGate}
          onChange={(e) =>
            onPropertyChange?.(
              "tranceGate",
              parseFloat(e.target.value),
            )
          }
          className="w-full h-2 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-cyan-400 border border-cyan-900/30 hover:accent-cyan-300 transition-all"
          aria-valuetext={`\${Math.round((currentTranceGate + 0.0001) * 100)}%`}
          aria-label="Trance Gate"
        />
      </div>

      {(trackType === "synth" || trackType === "voice") && onPropertyChange && (
          <DrawableLFO
              value={currentCustomWindowShape}
              onChange={(shape) => onPropertyChange("customWindowShape", shape)}
              label="Custom Window Shape"
          />
      )}
    </>
  );
});
