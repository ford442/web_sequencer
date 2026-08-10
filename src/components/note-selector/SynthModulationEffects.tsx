import React from "react";
import { PropertySlider } from "./PropertySlider";
import { ProphecyProperties } from "./ProphecyProperties";
import type { SynthEffectPropertiesProps } from "./synthEffectTypes";

export const SynthModulationEffects: React.FC<SynthEffectPropertiesProps> = React.memo((props) => {
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
    currentFormantShift = 0,
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
    currentFormantSidechainDepth = 0,
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
      {/* Formant Shift Control */}
      {(trackType === "voice" || trackType === "synth") &&
        currentFormantShift !== undefined && (
          <div className="flex flex-col gap-1 mb-2">
            <div className="flex justify-between text-[10px] text-cyan-200/70 font-bold uppercase">
              <label htmlFor="note-fmt-shift">Formant Shift</label>
              <span className="text-cyan-400 font-mono text-[10px] bg-zinc-950 px-1 py-0.5 rounded border border-zinc-800">
                {currentFormantShift > 0 ? "+" : ""}
                {currentFormantShift}st
              </span>
            </div>
            <input
              id="note-fmt-shift"
              type="range"
              min="-12"
              max="12"
              step="1"
              value={currentFormantShift}
              onChange={(e) =>
                onPropertyChange(
                  "formantShift",
                  parseFloat(e.target.value),
                )
              }
              className="w-full h-2 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-cyan-500 hover:accent-cyan-400 transition-all"
              aria-valuetext={`${currentFormantShift > 0 ? "+" : ""}${currentFormantShift} st`}
            />
            <div className="flex items-center gap-2 mt-1">
              <button type="button"
                className={`w-5 h-5 rounded flex items-center justify-center border ${currentSlideFormant ? "bg-cyan-500/20 border-cyan-500/50 text-cyan-300" : "bg-zinc-900 border-zinc-700 text-gray-500"} hover:bg-zinc-800 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900 focus-visible:ring-cyan-500`}
                onClick={() =>
                  onPropertyChange("slideFormant", !currentSlideFormant)
                }
                title="Glide Formant from Previous Step"
                aria-label="Toggle Formant Glide"
                aria-pressed={currentSlideFormant}
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M5 19L19 5" />
                  <path d="M19 19V5H5" />
                </svg>
              </button>
              <span className="text-[9px] uppercase font-mono tracking-widest text-gray-400">
                Glide
              </span>
            </div>
          </div>
        )}
      {/* Formant LFO Rate Control */}
      {trackType === "synth" && (
        <div className="flex flex-col gap-1">
          <div className="flex justify-between text-[10px] text-cyan-200/70 font-bold uppercase items-center">
            <label htmlFor="note-fmt-rate">Fmt LFO Rate</label>
            <div className="flex items-center gap-2">
              <button type="button"
                role="switch"
                aria-checked={currentFormantLfoSync || false}
                aria-label="Sync Formant LFO Rate to BPM"
                onClick={() =>
                  onPropertyChange?.(
                    "formantLfoSync",
                    !currentFormantLfoSync,
                  )
                }
                className={`px-1.5 py-0 rounded text-[8px] font-bold tracking-wider transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-indigo-400 ${currentFormantLfoSync ? "bg-indigo-600 text-white" : "bg-gray-700 text-gray-400 hover:bg-gray-600"}`}
              >
                SYNC
              </button>
              <span className="text-indigo-400 font-mono text-[10px] drop-shadow-[0_0_5px_rgba(129,140,248,0.5)]">
                {currentFormantLfoSync
                  ? ""
                  : `${currentFormantLfoRate.toFixed(1)} Hz`}
              </span>
            </div>
          </div>
          {currentFormantLfoSync ? (
            <select
              id="note-fmt-rate"
              value={currentFormantLfoRate}
              onChange={(e) =>
                onPropertyChange?.(
                  "formantLfoRate",
                  parseFloat(e.target.value),
                )
              }
              aria-label="Formant LFO Rate Subdivision"
              className="w-full bg-gray-800 text-indigo-400 text-xs font-mono rounded border border-indigo-900/30 px-1 py-1 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-indigo-400 hover:bg-gray-700 transition-colors"
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
              id="note-fmt-rate"
              type="range"
              min="0"
              max="20"
              step="0.1"
              value={currentFormantLfoRate}
              onChange={(e) =>
                onPropertyChange?.(
                  "formantLfoRate",
                  parseFloat(e.target.value),
                )
              }
              className="w-full h-2 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-indigo-400 border border-indigo-900/30 hover:accent-indigo-300 transition-all"
              aria-valuetext={`${currentFormantLfoRate.toFixed(1)} Hz`}
              aria-label="Formant LFO Rate"
            />
          )}
        </div>
      )}
       {/* Formant LFO Depth Control */}
      {trackType === "synth" && (
        <div className="flex flex-col gap-1">
          <div className="flex justify-between text-[10px] text-cyan-200/70 font-bold uppercase">
            <label htmlFor="note-fmt-depth">Fmt LFO Depth</label>
            <span className="text-indigo-400 font-mono text-[10px] drop-shadow-[0_0_5px_rgba(129,140,248,0.5)]">
              {Math.round((currentFormantLfoDepth + 0.0001) * 100)}%
            </span>
          </div>
          <input
            id="note-fmt-depth"
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={currentFormantLfoDepth}
            onChange={(e) =>
              onPropertyChange(
                "formantLfoDepth",
                parseFloat(e.target.value),
              )
            }
            className="w-full h-2 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-indigo-400 border border-indigo-900/30 hover:accent-indigo-300 transition-all"
            aria-valuetext={`${Math.round((currentFormantLfoDepth + 0.0001) * 100)}%`}
            aria-label="Formant LFO Depth"
          />
        </div>
      )}
       {/* ── Tremolo (Rate & Depth) ────────────────────────────────────── */}
      <div className="flex flex-col gap-1">
        <div className="flex justify-between text-[10px] text-cyan-200/70 font-bold uppercase">
          <label htmlFor="note-tremolo-rate">Tremolo Rate</label>
          <span className="text-cyan-400 font-mono text-[10px] drop-shadow-[0_0_5px_rgba(34,211,238,0.5)]">
            {Math.round((currentTremoloRate + 0.0001) * 10) / 10} Hz
          </span>
        </div>
        <input
          id="note-tremolo-rate"
          type="range"
          min="0.1"
          max="20"
          step="0.1"
          value={currentTremoloRate}
          onChange={(e) =>
            onPropertyChange && onPropertyChange("tremoloRate", parseFloat(e.target.value))
          }
          className="w-full h-2 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-cyan-400 border border-cyan-900/30 hover:accent-cyan-300 transition-all"
          aria-valuetext={`${Math.round((currentTremoloRate + 0.0001) * 10) / 10} Hz`}
          aria-label="Tremolo Rate"
        />
      </div>
       <div className="flex flex-col gap-1 mt-2">
        <div className="flex justify-between text-[10px] text-cyan-200/70 font-bold uppercase">
          <label htmlFor="note-tremolo-depth">Tremolo Depth</label>
          <span className="text-cyan-400 font-mono text-[10px] drop-shadow-[0_0_5px_rgba(34,211,238,0.5)]">
            {Math.round((currentTremoloDepth + 0.0001) * 100)}%
          </span>
        </div>
        <input
          id="note-tremolo-depth"
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={currentTremoloDepth}
          onChange={(e) =>
            onPropertyChange && onPropertyChange("tremoloDepth", parseFloat(e.target.value))
          }
          className="w-full h-2 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-cyan-400 border border-cyan-900/30 hover:accent-cyan-300 transition-all"
          aria-valuetext={`${Math.round((currentTremoloDepth + 0.0001) * 100)}%`}
          aria-label="Tremolo Depth"
        />
      </div>
       {/* Pitch Envelope Controls */}
      <fieldset className="flex flex-col gap-2 p-2 bg-gray-800/40 rounded border border-purple-900/30">
        <legend className="sr-only">Pitch Envelope</legend>
        <div className="flex justify-between items-center px-1">
          <span className="text-[10px] text-purple-400 font-mono tracking-wider font-semibold">
            PITCH ENV
          </span>
        </div>
        <div className="flex gap-2 justify-between">
          <div className="flex flex-col items-center gap-1">
            <label htmlFor="note-pitch-amt" className="text-[9px] text-gray-500 font-mono">
              AMT
            </label>
            <input
              id="note-pitch-amt"
              type="range"
              min="-24"
              max="24"
              step="0.1"
              value={currentPitchAmount ?? 0}
              data-property="pitchAmount"
              onChange={(e) =>
                onPropertyChange?.(
                  e.target.dataset.property as any,
                  parseFloat(e.target.value),
                )
              }
              className="w-16 accent-purple-400"
              aria-label="Pitch Envelope Amount"
            />
            <span className="text-[10px] text-gray-300 font-mono">
              {(currentPitchAmount ?? 0) > 0 ? "+" : ""}
              {(currentPitchAmount ?? 0).toFixed(1)}st
            </span>
          </div>
          <div className="flex flex-col items-center gap-1">
            <label htmlFor="note-pitch-atk" className="text-[9px] text-gray-500 font-mono">
              ATK
            </label>
            <input
              id="note-pitch-atk"
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={currentPitchAttack ?? 0}
              data-property="pitchAttack"
              onChange={(e) =>
                onPropertyChange?.(
                  e.target.dataset.property as any,
                  parseFloat(e.target.value),
                )
              }
              className="w-16 accent-purple-400"
              aria-label="Pitch Envelope Attack"
            />
          </div>
          <div className="flex flex-col items-center gap-1">
            <label htmlFor="note-pitch-dec" className="text-[9px] text-gray-500 font-mono">
              DEC
            </label>
            <input
              id="note-pitch-dec"
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={currentPitchDecay ?? 0}
              data-property="pitchDecay"
              onChange={(e) =>
                onPropertyChange?.(
                  e.target.dataset.property as any,
                  parseFloat(e.target.value),
                )
              }
              className="w-16 accent-purple-400"
              aria-label="Pitch Envelope Decay"
            />
          </div>
        </div>
      </fieldset>
       {/* Formant Envelope Controls */}
      {trackType === "synth" && (
        <div className="flex flex-col gap-1 mt-2 p-2 bg-gray-800/40 rounded border border-indigo-900/30">
          <div className="flex justify-between items-center text-[10px] text-cyan-200/70 font-bold uppercase mb-1">
            <label htmlFor="note-fmt-env-sync">Formant Env Sync</label>
            <button type="button"
              role="switch"
              aria-checked={currentFormantEnvSync || false}
              id="note-fmt-env-sync" aria-label="Sync Formant Envelope to BPM"
              onClick={() =>
                onPropertyChange?.(
                  "formantEnvSync",
                  !currentFormantEnvSync,
                )
              }
              className={`px-1.5 py-0.5 rounded text-[8px] font-bold tracking-wider transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-indigo-400 ${currentFormantEnvSync ? "bg-indigo-600 text-white" : "bg-gray-700 text-gray-400 hover:bg-gray-600"}`}
            >
              SYNC
            </button>
          </div>
          <div className="flex flex-col gap-1 mt-1">
            <div className="flex justify-between text-[10px] text-cyan-200/70 font-bold uppercase">
              <label htmlFor="note-fmt-env-atk">Attack</label>
              <span className="text-indigo-400 font-mono text-[10px]">
                {currentFormantEnvSync
                  ? ""
                  : `${currentFormantEnvAttack.toFixed(2)} s`}
              </span>
            </div>
            {currentFormantEnvSync ? (
              <select
                id="note-fmt-env-atk"
                value={currentFormantEnvAttack}
                onChange={(e) =>
                  onPropertyChange?.(
                    "formantEnvAttack",
                    parseFloat(e.target.value),
                  )
                }
                className="w-full bg-gray-900 text-indigo-400 text-xs font-mono rounded border border-indigo-900/50 px-2 py-1 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-indigo-400"
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
                id="note-fmt-env-atk"
                type="range"
                min="0.01"
                max="5"
                step="0.01"
                value={currentFormantEnvAttack}
                onChange={(e) =>
                  onPropertyChange?.(
                    "formantEnvAttack",
                    parseFloat(e.target.value),
                  )
                }
                className="w-full h-2 bg-gray-900 rounded-lg appearance-none cursor-pointer accent-indigo-400 hover:accent-indigo-300 transition-all"
              />
            )}
          </div>
          <div className="flex flex-col gap-1 mt-2">
            <div className="flex justify-between text-[10px] text-cyan-200/70 font-bold uppercase">
              <label htmlFor="note-fmt-env-dec">Decay</label>
              <span className="text-indigo-400 font-mono text-[10px]">
                {currentFormantEnvSync
                  ? ""
                  : `${currentFormantEnvDecay.toFixed(2)} s`}
              </span>
            </div>
            {currentFormantEnvSync ? (
              <select
                id="note-fmt-env-dec"
                value={currentFormantEnvDecay}
                onChange={(e) =>
                  onPropertyChange?.(
                    "formantEnvDecay",
                    parseFloat(e.target.value),
                  )
                }
                className="w-full bg-gray-900 text-indigo-400 text-xs font-mono rounded border border-indigo-900/50 px-2 py-1 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-indigo-400"
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
                id="note-fmt-env-dec"
                type="range"
                min="0.01"
                max="5"
                step="0.01"
                value={currentFormantEnvDecay}
                onChange={(e) =>
                  onPropertyChange?.(
                    "formantEnvDecay",
                    parseFloat(e.target.value),
                  )
                }
                className="w-full h-2 bg-gray-900 rounded-lg appearance-none cursor-pointer accent-indigo-400 hover:accent-indigo-300 transition-all"
              />
            )}
          </div>
          <div className="flex flex-col gap-1 mt-2">
            <div className="flex justify-between text-[10px] text-cyan-200/70 font-bold uppercase">
              <label htmlFor="note-fmt-env-amt">Amount</label>
              <span className="text-indigo-400 font-mono text-[10px]">
                {currentFormantEnvAmount > 0 ? "+" : ""}
                {currentFormantEnvAmount} st
              </span>
            </div>
            <input
              id="note-fmt-env-amt"
              type="range"
              min="-24"
              max="24"
              step="1"
              value={currentFormantEnvAmount}
              onChange={(e) =>
                onPropertyChange?.(
                  "formantEnvAmount",
                  parseFloat(e.target.value),
                )
              }
              className="w-full h-2 bg-gray-900 rounded-lg appearance-none cursor-pointer accent-indigo-400 hover:accent-indigo-300 transition-all"
            />
          </div>
          <div className="flex flex-col gap-1 mt-2">
            <div className="flex justify-between text-[10px] text-cyan-200/70 font-bold uppercase">
              <label htmlFor="note-fmt-env-duck">Ducking (Kick)</label>
              <span className="text-indigo-400 font-mono text-[10px]">
                {currentFormantSidechainDepth} st
              </span>
            </div>
            <input
              id="note-fmt-env-duck"
              type="range"
              min="0"
              max="24"
              step="1"
              value={currentFormantSidechainDepth}
              onChange={(e) =>
                onPropertyChange?.(
                  "formantSidechainDepth",
                  parseFloat(e.target.value),
                )
              }
              className="w-full h-2 bg-gray-900 rounded-lg appearance-none cursor-pointer accent-indigo-400 hover:accent-indigo-300 transition-all"
            />
          </div>
          <div className="flex flex-col gap-1 mt-2">
            <div className="flex justify-between text-[10px] text-cyan-200/70 font-bold uppercase">
              <label htmlFor="note-fmt-env-fol">Env Follower</label>
              <span className="text-indigo-400 font-mono text-[10px]">
                {currentFormantEnvFollower > 0 ? "+" : ""}
                {currentFormantEnvFollower} st
              </span>
            </div>
            <input
              id="note-fmt-env-fol"
              type="range"
              min="-24"
              max="24"
              step="1"
              value={currentFormantEnvFollower}
              onChange={(e) =>
                onPropertyChange?.(
                  "formantEnvFollower",
                  parseFloat(e.target.value),
                )
              }
              className="w-full h-2 bg-gray-900 rounded-lg appearance-none cursor-pointer accent-indigo-400 hover:accent-indigo-300 transition-all"
            />
          </div>
        </div>
      )}
       {/* Drive / Distortion Control */}
      {trackType === "synth" && (
        <div className="flex flex-col gap-1">
          <div className="flex justify-between text-[10px] text-cyan-200/70 font-bold uppercase">
            <label htmlFor="note-drive">Distortion</label>
            <span className="text-red-400 font-mono text-[10px] drop-shadow-[0_0_5px_rgba(248,113,113,0.5)]">
              {currentDrive !== undefined
                ? Math.round(currentDrive * 100)
                : 0}
              %
            </span>
          </div>
          <input
            id="note-drive"
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={currentDrive !== undefined ? currentDrive : 0}
            onChange={(e) =>
              onPropertyChange("drive", parseFloat(e.target.value))
            }
            className="w-full h-2 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-red-400 border border-red-900/30 hover:accent-red-300 transition-all"
            aria-valuetext={`${currentDrive !== undefined ? Math.round(currentDrive * 100) : 0}%`}
            aria-label="Distortion"
          />
        </div>
      )}
       {/* Vibrato Depth Control */}
      {trackType === "synth" && (
        <div className="flex flex-col gap-1">
          <div className="flex justify-between text-[10px] text-cyan-200/70 font-bold uppercase">
            <label htmlFor="note-vibrato-depth">Vibrato Depth</label>
            <span className="text-cyan-400 font-mono text-[10px] drop-shadow-[0_0_5px_rgba(34,211,238,0.5)]">
              {Math.round((currentVibratoDepth + 0.0001) * 100)}%
            </span>
          </div>
          <input
            id="note-vibrato-depth"
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={currentVibratoDepth}
            onChange={(e) =>
              onPropertyChange(
                "vibratoDepth",
                parseFloat(e.target.value),
              )
            }
            className="w-full h-2 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-cyan-400 border border-cyan-900/30 hover:accent-cyan-300 transition-all"
            aria-valuetext={`${Math.round((currentVibratoDepth + 0.0001) * 100)}%`}
            aria-label="Vibrato Depth"
          />
        </div>
      )}
      {isProphecy && onPropertyChange && (
        <ProphecyProperties
          onPropertyChange={onPropertyChange}
          currentVowel={currentVowel}
          currentPortamento={currentPortamento}
        />
      )}
      {/* Morph Override */}
      {onPropertyChange && currentCharacterMorph !== undefined && (
        <div className="flex flex-col gap-1">
          <div className="flex justify-between text-[10px] text-cyan-200/70 font-bold uppercase">
            <label htmlFor="note-morph">Character Morph</label>
            <span className="text-cyan-400 font-mono text-[10px] drop-shadow-[0_0_5px_rgba(34,211,238,0.5)]">
              {Math.round((currentCharacterMorph + 0.0001) * 100)}%
            </span>
          </div>
          <input
            id="note-morph"
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={currentCharacterMorph}
            onChange={(e) =>
              onPropertyChange(
                "characterMorph",
                parseFloat(e.target.value),
              )
            }
            className="w-full h-2 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-cyan-400 border border-cyan-900/30 hover:accent-cyan-300 transition-all"
            aria-valuetext={`${Math.round((currentCharacterMorph + 0.0001) * 100)}%`}
            aria-label="Character Morph"
          />
        </div>
      )}
       {/* Filter Cutoff Control */}
      <PropertySlider
        label="Filter Cutoff"
        id="note-cutoff"
        value={
          currentFilterCutoff !== undefined ? currentFilterCutoff : 1
        }
        onChange={(v) => onPropertyChange?.("filterCutoff", v)}
        valueFormatter={() =>
          currentFilterCutoff !== undefined
            ? `${Math.round(currentFilterCutoff * 100)}%`
            : "OFF"
        }
        ariaLabel="Filter Cutoff Override"
      />
       {/* Filter Resonance Control */}
      <PropertySlider
        label="Filter Res"
        id="note-resonance"
        value={
          currentFilterResonance !== undefined
            ? currentFilterResonance
            : 0
        }
        onChange={(v) => onPropertyChange?.("filterResonance", v)}
        valueFormatter={() =>
          currentFilterResonance !== undefined
            ? `${Math.round(currentFilterResonance * 100)}%`
            : "OFF"
        }
        ariaLabel="Filter Resonance Override"
      />
       {/* Envelope Mod Control */}
      <PropertySlider
        label="Env Mod"
        id="note-envmod"
        min={-1}
        max={1}
        step={0.01}
        value={currentEnvMod !== undefined ? currentEnvMod : 0}
        onChange={(v) => onPropertyChange?.("envMod", v)}
        valueFormatter={() =>
          currentEnvMod !== undefined
            ? `${currentEnvMod > 0 ? "+" : ""}${Math.round(currentEnvMod * 100)}%`
            : "OFF"
        }
        ariaLabel="Env Mod Override"
      />
       {/* Retrigger (Ratchet) Control */}
      <fieldset className="flex flex-col gap-1 pb-1 border-none p-0 m-0">
        <legend className="sr-only">Retrigger Control</legend>
        <div
          className="flex justify-between text-[10px] text-cyan-200/70 font-bold uppercase"
          aria-hidden="true"
        >
          <span id="retrigger-label">Retrigger</span>
          <span className="text-purple-400 font-mono text-[10px] drop-shadow-[0_0_5px_rgba(192,132,252,0.5)]">
            {currentRetrigger > 1 ? `${currentRetrigger}x` : "OFF"}
          </span>
        </div>
        <div
          role="group"
          aria-labelledby="retrigger-label"
          className="flex gap-1"
        >
          {[1, 2, 3, 4].map((val) => (
            <button type="button"
              key={val}
              onClick={() => onPropertyChange("retrigger", val)}
              className={`flex-1 py-1 text-[10px] font-bold rounded transition-all ${currentRetrigger === val ? "bg-purple-600 text-white shadow-[0_0_10px_rgba(147,51,234,0.3)]" : "bg-gray-800/80 text-cyan-200/70 hover:bg-gray-700 hover:text-white border border-gray-700/50"}`}
              aria-pressed={currentRetrigger === val}
              aria-label={
                val === 1 ? "No retrigger" : `Retrigger ${val} times`
              }
            >
              {val === 1 ? "1x" : `${val}x`}
            </button>
          ))}
        </div>
      </fieldset>
    </>
  );
});
