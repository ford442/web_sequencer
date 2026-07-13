import React from "react";
import type { SynthEffectPropertiesProps } from "./synthEffectTypes";

export const SynthSpectralEffects: React.FC<SynthEffectPropertiesProps> = React.memo((props) => {
  const {
    trackType,
    onPropertyChange,
    isProphecy = false,
    currentFreeze = 0,
    currentFreezeLfoSync = false,
    currentFreezeLfoRate = 0,
    currentFreezeLfoDepth = 0,
    currentFreezeEnvDepth = 0,
    currentGrainEnvDepth = 0,
    currentGrainPitchEnvDepth = 0,
    currentGrainJitter = 0,
    currentGrainPitchQuantize = 0,
    currentGranularPitchShift = 0,
    currentVocoderMix,
    currentVocoderFormantShift,
    currentVocoderPreservation,
    currentBitcrush = 0,
    currentDownsample = 1,
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
  return (
    <>
      {(trackType === "voice" || trackType === "synth") && (
        <fieldset className="flex flex-col gap-2 mb-2 p-1.5 bg-gray-800/40 rounded border border-indigo-900/30">
          <legend className="sr-only">
            Spectral and Time Processing
          </legend>
          <div
            className="text-[10px] text-indigo-300/80 font-bold uppercase mb-1 tracking-wider border-b border-indigo-900/50 pb-1"
            aria-hidden="true"
          >
            Spectral & Time
          </div>
           {/* Time Stretch Envelope Depth */}
          <div className="flex flex-col gap-1">
            <div
              className="flex justify-between text-[10px] text-cyan-200/70 font-bold uppercase"
              aria-hidden="true"
            >
              <label htmlFor="note-timestretch-env">Env → Time</label>
              <span className="text-cyan-400 font-mono text-[10px] drop-shadow-[0_0_5px_rgba(34,211,238,0.5)]">
                {Math.round(
                  ((currentTimeStretchEnvDepth ?? 0) + 0.0001) * 100,
                )}
                %
              </span>
            </div>
            <input
              id="note-timestretch-env"
              type="range"
              min="-1"
              max="1"
              step="0.01"
              value={currentTimeStretchEnvDepth ?? 0}
              onChange={(e) =>
                onPropertyChange?.(
                  "timeStretchEnvDepth",
                  parseFloat(e.target.value),
                )
              }
              className="w-full h-2 bg-gray-900 rounded-lg appearance-none cursor-pointer accent-indigo-400 border border-indigo-900/30 hover:accent-indigo-300 transition-all"
              aria-label="Time Stretch Envelope Depth"
              aria-valuetext={`${Math.round(((currentTimeStretchEnvDepth ?? 0) + 0.0001) * 100)}%`}
            />
          </div>
           {/* Spectral Pan Rate */}
          <div className="flex flex-col gap-1">
            <div
              className="flex justify-between text-[10px] text-cyan-200/70 font-bold uppercase"
              aria-hidden="true"
            >
              <label htmlFor="note-spectral-pan-rate">
                Spectral Pan Rate
              </label>
              <span className="text-cyan-400 font-mono text-[10px]">
                {(currentSpectralPanRate ?? 0).toFixed(1)} Hz
              </span>
            </div>
            <input
              id="note-spectral-pan-rate"
              type="range"
              min="0.1"
              max="10"
              step="0.1"
              value={currentSpectralPanRate ?? 0}
              onChange={(e) =>
                onPropertyChange?.(
                  "spectralPanRate",
                  parseFloat(e.target.value),
                )
              }
              className="w-full h-2 bg-gray-900 rounded-lg appearance-none cursor-pointer accent-indigo-400 border border-indigo-900/30 hover:accent-indigo-300 transition-all"
              aria-label="Spectral Pan Rate"
              aria-valuetext={`${(currentSpectralPanRate ?? 0).toFixed(1)} Hz`}
            />
          </div>
           {/* Spectral Pan Depth */}
          <div className="flex flex-col gap-1">
            <div
              className="flex justify-between text-[10px] text-cyan-200/70 font-bold uppercase"
              aria-hidden="true"
            >
              <label htmlFor="note-spectral-pan-depth">
                Spectral Pan Depth
              </label>
              <span className="text-cyan-400 font-mono text-[10px]">
                {Math.round(
                  ((currentSpectralPanDepth ?? 0) + 0.0001) * 100,
                )}
                %
              </span>
            </div>
            <input
              id="note-spectral-pan-depth"
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={currentSpectralPanDepth ?? 0}
              onChange={(e) =>
                onPropertyChange?.(
                  "spectralPanDepth",
                  parseFloat(e.target.value),
                )
              }
              className="w-full h-2 bg-gray-900 rounded-lg appearance-none cursor-pointer accent-indigo-400 border border-indigo-900/30 hover:accent-indigo-300 transition-all"
              aria-label="Spectral Pan Depth"
              aria-valuetext={`${Math.round(((currentSpectralPanDepth ?? 0) + 0.0001) * 100)}%`}
            />
          </div>
        </fieldset>
      )}
       {/* Reverse Control */}
      <div className="flex justify-between items-center text-[10px] text-cyan-200/70 font-bold uppercase py-1">
        <label htmlFor="note-reverse">Reverse Sample</label>
        <button type="button"
          id="note-reverse"
          onClick={() => onPropertyChange("reverse", !currentReverse)}
          className={`w-8 h-4 rounded-full transition-colors flex items-center px-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900 ${currentReverse ? "bg-cyan-500 justify-end shadow-[0_0_8px_rgba(6,182,212,0.4)]" : "bg-gray-700 justify-start border border-gray-600"}`}
          aria-checked={currentReverse}
          role="switch"
          aria-label="Play slice in reverse"
          title="Play slice in reverse"
        >
          <div className="w-3 h-3 rounded-full bg-white shadow-sm" />
        </button>
      </div>
    </>
  );
});
