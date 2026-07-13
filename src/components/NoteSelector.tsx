import { PropertyToggle } from "./note-selector/PropertyToggle";
import { PropertySlider } from "./note-selector/PropertySlider";
import React, { memo } from "react";
import { NOTES, getScaleNotes } from "../utils/musicTheory";
import type { ScaleDefinition } from "../utils/musicTheory";
import { useFocusTrap } from "../hooks/useFocusTrap";
interface NoteSelectorProps {
  x: number;
  y: number;
  trackType: "synth" | "drum" | "voice";
  currentNote: string;
  currentLength: number;
  currentPan?: number;
  currentPitchAmount?: number;
  currentPitchAttack?: number;
  currentPitchDecay?: number;
  onSelect: (note: string) => void;
  onLengthChange: (length: number) => void;
  onClose: () => void;
  getNoteColor: (note: string) => string;
  currentScale?: ScaleDefinition | null;

  // Per-step parameters
  currentTimbre?: number;
  currentVelocity?: number;
  currentProbability?: number;
  currentMicrotiming?: number;
  currentReverse?: boolean;
  currentRetrigger?: number;
  currentFreeze?: number;
  currentBitcrush?: number;
  currentDownsample?: number;
  currentFormantShift?: number;
  currentSlideFormant?: boolean;
  currentFilterCutoff?: number;
  currentFilterResonance?: number;
  currentEnvMod?: number;
  currentFormantLfoSync?: boolean;
  currentFormantLfoRate?: number;
  currentFormantLfoDepth?: number;
  currentFormantEnvSync?: boolean;
  currentFormantEnvAttack?: number;
  currentFormantEnvDecay?: number;
  currentFormantEnvAmount?: number;
  currentFormantEnvFollower?: number;
  currentFreezeLfoSync?: boolean;
  currentFreezeLfoRate?: number;
  currentFreezeLfoDepth?: number;
  currentVibratoDepth?: number;
  currentTremoloDepth?: number;
  currentTremoloRate?: number;
  currentDrive?: number;
  currentCharacterMorph?: number;
  currentReverbSend?: number;
  currentReverbType?: import("../types").ReverbType;
  currentReverbLfoRate?: number;
  currentReverbLfoDepth?: number;
  currentDelayLfoRate?: number;
  currentDelayLfoDepth?: number;
  currentFreezeEnvDepth?: number;
  currentGrainEnvDepth?: number;
  currentGrainPitchEnvDepth?: number;
  currentGrainJitter?: number;
  currentGrainPitchQuantize?: number;
  currentGranularPitchShift?: number;
  currentTimeStretchEnvDepth?: number;
  currentSpectralPanRate?: number;
  currentSpectralPanDepth?: number;
  currentTranceGate?: number;
  currentDelaySend?: number;
  currentChoir?: number;
  currentVocoderMix?: number;
  currentVocoderFormantShift?: number;
  currentFormantPitchLink?: number;
  currentVocoderPreservation?: number;
  currentVocoderAttack?: number;
  currentVocoderRelease?: number;
  currentGateDepth?: number;
  currentGateRate?: number;
  /** Prophecy: whether the active synth uses a prophecy-* waveform */
  isProphecy?: boolean;
  /** Prophecy: current vowel formant 0–4 */
  currentVowel?: number;
  /** Prophecy: current portamento rate 0–1 */
  currentPortamento?: number;
  onPropertyChange?: (
    key:
      | "timbre"
      | "velocity"
      | "probability"
      | "microtiming"
      | "reverse"
      | "retrigger"
      | "freeze"
      | "freezeEnvDepth"
      | "grainEnvDepth"
      | "grainPitchEnvDepth"
      | "grainJitter"
      | "grainPitchQuantize"
      | "timeStretchEnvDepth"
      | "spectralPanRate"
      | "spectralPanDepth"
      | "granularPitchShift"
      | "bitcrush"
      | "downsample"
      | "tranceGate"
      | "bitcrush"
      | "downsample"
      | "formantShift"
      | "formantPitchLink"
      | "filterCutoff"
      | "filterResonance"
      | "envMod"
      | "slideFormant"
      | "formantLfoSync"
      | "formantLfoRate"
      | "formantLfoDepth"
      | "freezeLfoSync"
      | "freezeLfoRate"
      | "freezeLfoDepth"
      | "formantEnvAttack"
      | "formantEnvDecay"
      | "formantEnvAmount"
      | "formantEnvFollower"
      | "formantEnvSync"
      | "vibratoDepth"
      | "tremoloDepth"
      | "tremoloRate"
      | "gateDepth"
      | "gateRate"
      | "pan"
      | "drive"
      | "characterMorph"
      | "reverbSend"
      | "reverbType"
      | "reverbLfoRate"
      | "reverbLfoDepth"
      | "delayLfoRate"
      | "delayLfoDepth"
      | "delaySend"
      | "choir"
      | "vocoderMix"
      | "vocoderFormantShift"
      | "vocoderPreservation"
      | "vocoderAttack"
      | "vocoderRelease"
      | "vowel"
      | "portamento"
      | "pitchAttack"
      | "pitchDecay"
      | "pitchAmount"
      | "glitchChance"
      | "probability",
    value: number | boolean | string,
  ) => void;
}

export const NoteSelector: React.FC<NoteSelectorProps> = memo(
  ({
    currentPan,
    x,
    y,
    trackType,
    currentNote,
    currentLength,
    onSelect,
    onLengthChange,
    onClose,
    getNoteColor,
    currentScale,

    currentTimbre = 0,
    currentVelocity = 1,
    currentProbability = 1,
    currentMicrotiming = 0,
    currentPitchAmount = 0,
    currentPitchAttack = 0,
    currentPitchDecay = 0,
    currentReverse = false,
    currentRetrigger = 1,
    currentFreeze = 0,
    currentFormantShift,
    currentSlideFormant = false,
    currentFilterCutoff,
    currentFilterResonance,
    currentEnvMod,
    currentFormantLfoSync,
    currentFormantLfoRate = 0,
    currentFormantLfoDepth = 0,
    currentFormantEnvSync,
    currentFormantEnvAttack = 0.1,
    currentFormantEnvDecay = 0.5,
    currentFormantEnvAmount = 0,
    currentFormantEnvFollower = 0,
    currentFreezeLfoSync = false,
    currentFreezeLfoRate = 0,
    currentFreezeLfoDepth = 0,
    currentVibratoDepth = 0,
    currentTremoloDepth = 0,
    currentTremoloRate = 0,
    currentDrive,
    currentCharacterMorph = 0,
    currentReverbSend,
    currentReverbType,
    currentReverbLfoRate,
    currentReverbLfoDepth,
    currentDelayLfoRate,
    currentDelayLfoDepth,
    currentDelaySend,
    currentFreezeEnvDepth = 0,
    currentGrainEnvDepth = 0,
    currentGrainPitchEnvDepth = 0,
    currentGrainJitter = 0,
    currentGrainPitchQuantize = 0,
    currentTimeStretchEnvDepth = 0,
    currentSpectralPanRate = 0,
    currentSpectralPanDepth = 0,
    currentGranularPitchShift = 0,
    currentBitcrush = 0,
    currentDownsample = 1,
    currentChoir,
    currentVocoderMix,
    currentVocoderFormantShift,
    currentFormantPitchLink,
    currentVocoderPreservation,
    currentVocoderAttack,
    currentVocoderRelease,
    currentTranceGate = 0, // from jules branch

    currentGateDepth = 0,
    currentGateRate = 8,
    isProphecy = false,
    currentVowel = 0,
    currentPortamento = 0,
    onPropertyChange,
  }) => {
    // Determine octave range based on track type
    const octaves = trackType === "synth" ? [2, 3, 4] : [2];
    const scaleNotes = currentScale ? getScaleNotes(currentScale) : null;

    const dialogRef = useFocusTrap(true, onClose);

    return (
      <>
        {/* Backdrop for click-outside */}
        <div
          className="fixed inset-0 z-40 bg-transparent"
          onClick={onClose}
          aria-hidden="true"
        />

        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="note-selector-title"
          aria-describedby="note-selector-kbd-hint"
          tabIndex={-1}
          className="fixed z-50 bg-gray-900/80 backdrop-blur-md border border-cyan-900/50 rounded-lg shadow-[0_0_20px_rgba(6,182,212,0.15)] p-3 grid gap-3 outline-none animate-in fade-in zoom-in-95 duration-100"
          style={{
            left: Math.min(x, window.innerWidth - 320),
            top: Math.min(y, window.innerHeight - 400),
          }}
        >
          <div className="flex justify-between items-center pb-2 border-b border-cyan-900/30">
            <span
              id="note-selector-title"
              className="text-xs font-bold font-orbitron text-cyan-400 tracking-widest drop-shadow-[0_0_8px_rgba(6,182,212,0.5)]"
            >
              NOTE PROPERTIES
            </span>
            <button type="button"
              onClick={onClose}
              aria-label="Close note properties"
              title="Close note properties (Esc)"
              className="text-cyan-600 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-cyan-400 rounded"
            >
              <span aria-hidden="true">✕</span>
            </button>
          </div>
          <p id="note-selector-kbd-hint" className="sr-only">
            Tab through note and property controls. Escape closes this panel.
          </p>

          {/* NEW: Duration Control */}
          <PropertySlider
            label="Duration"
            id="note-duration"
            value={currentLength || 1}
            min={1}
            max={16}
            step={1}
            onChange={(v) => onLengthChange(v)}
            valueFormatter={(v) => `${v} Steps`}
          />

          {onPropertyChange && (
            <>
              {/* Velocity Control */}
              <PropertySlider
                label="Velocity"
                id="note-velocity"
                value={currentVelocity}
                onChange={(v) => onPropertyChange?.("velocity", v)}
                valueFormatter={(v) => `${Math.round(v * 100)}%`}
                ariaLabel="Velocity"
              />

              {/* Timbre Control */}
              <PropertySlider
                label="Expression"
                id="note-timbre"
                value={currentTimbre}
                onChange={(v) => onPropertyChange?.("timbre", v)}
                valueFormatter={(v) => `${Math.round(v * 100)}%`}
                ariaLabel="Expression"
              />

              {/* Probability Control */}
              <PropertySlider
                label="Probability"
                id="note-prob"
                value={currentProbability}
                onChange={(v) => onPropertyChange?.("probability", v)}
                valueFormatter={(v) => `${Math.round(v * 100)}%`}
                ariaLabel="Probability"
                ariaDescribedBy="note-prob-desc"
              />
              <p id="note-prob-desc" className="sr-only">
                Chance this step triggers during playback. 100% always plays; lower values add random variation.
              </p>

              {/* Microtiming Control */}
              <PropertySlider
                label="Microtiming"
                id="note-micro"
                value={currentMicrotiming}
                min={-0.5}
                max={0.5}
                onChange={(v) => onPropertyChange?.("microtiming", v)}
                valueFormatter={(v) => `${Math.round(v * 100)}%`}
                ariaLabel="Microtiming"
                ariaDescribedBy="note-micro-desc"
              />
              <p id="note-micro-desc" className="sr-only">
                Nudges the step earlier or later within the beat. Negative values play ahead; positive values delay.
              </p>

              {/* Freeze (Spectral Smear) Control */}
              {trackType === "synth" && (
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

                  <PropertySlider
                    label="Vocoder Mix"
                    id="note-vocoder-mix"
                    ariaLabel="Vocoder Mix Override"
                    value={currentVocoderMix ?? 0}
                    onChange={(v) => onPropertyChange?.("vocoderMix", v)}
                    valueFormatter={() =>
                      `${((currentVocoderMix ?? 0) * 100).toFixed(0)}%`
                    }
                    accentColor="accent-indigo-400 hover:accent-indigo-300"
                    borderColor="border-indigo-900/30"
                  />

                  <div className="flex flex-col gap-1">
                    <div className="flex justify-between text-[10px] text-indigo-200/70 font-bold uppercase">
                      <label htmlFor="note-vocoder-formant-shift">Voc Fmt Sft</label>
                      <span className="text-indigo-400 font-mono text-[10px] drop-shadow-[0_0_5px_rgba(129,140,248,0.5)]">
                        {currentVocoderFormantShift ?? 0}
                      </span>
                    </div>
                    <input
                      id="note-vocoder-formant-shift"
                      type="range"
                      min="-12"
                      max="12"
                      step="1"
                      value={currentVocoderFormantShift ?? 0}
                      onChange={(e) =>
                        onPropertyChange?.(
                          "vocoderFormantShift",
                          parseFloat(e.target.value),
                        )
                      }
                      className="w-full h-2 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-indigo-400 hover:accent-indigo-300 transition-all border border-indigo-900/30"
                      aria-label="Vocoder Formant Shift Override"
                    />
                  </div>

                  <div className="flex flex-col gap-1">
                    <div className="flex justify-between text-[10px] text-indigo-200/70 font-bold uppercase">
                      <label htmlFor="note-formant-pitch-link">Fmt Link</label>
                      <span className="text-indigo-400 font-mono text-[10px] drop-shadow-[0_0_5px_rgba(129,140,248,0.5)]">
                        {currentFormantPitchLink?.toFixed(2) ?? '0.00'}
                      </span>
                    </div>
                    <input
                      id="note-formant-pitch-link"
                      type="range"
                      min="-1"
                      max="1"
                      step="0.01"
                      value={currentFormantPitchLink ?? 0}
                      onChange={(e) =>
                        onPropertyChange?.(
                          "formantPitchLink",
                          parseFloat(e.target.value),
                        )
                      }
                      className="w-full h-2 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-indigo-400 hover:accent-indigo-300 transition-all border border-indigo-900/30"
                      aria-label="Formant Pitch Link Override"
                    />
                  </div>

                  <div className="flex flex-col gap-1">
                    <div className="flex justify-between text-[10px] text-indigo-200/70 font-bold uppercase">
                      <label htmlFor="note-vocoder-preservation">Voc Preserv</label>
                      <span className="text-indigo-400 font-mono text-[10px] drop-shadow-[0_0_5px_rgba(129,140,248,0.5)]">
                        {((currentVocoderPreservation ?? 1.0) * 100).toFixed(0)}%
                      </span>
                    </div>
                    <input
                      id="note-vocoder-preservation"
                      type="range"
                      min="0"
                      max="1"
                      step="0.01"
                      value={currentVocoderPreservation ?? 1.0}
                      onChange={(e) =>
                        onPropertyChange?.(
                          "vocoderPreservation",
                          parseFloat(e.target.value),
                        )
                      }
                      className="w-full h-2 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-indigo-400 hover:accent-indigo-300 transition-all border border-indigo-900/30"
                      aria-label="Vocoder Preservation Override"
                    />
                  </div>

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
                </>
              )}

              {/* Pan Control */}
              <PropertySlider
                label="Pan"
                id="note-pan"
                value={currentPan || 0}
                min={-1}
                max={1}
                onChange={(v) => onPropertyChange?.("pan", v)}
                valueFormatter={(v) =>
                  v === 0
                    ? "C"
                    : v < 0
                      ? `L${Math.round((v + 1) * 50)}`
                      : `R${Math.round(v * 50)}`
                }
                ariaLabel="Pan"
              />

              {/* Pan Control */}
              <PropertySlider
                label="Pan"
                id="note-pan"
                value={currentPan || 0}
                min={-1}
                max={1}
                onChange={(v) => onPropertyChange?.("pan", v)}
                valueFormatter={(v) =>
                  v === 0
                    ? "C"
                    : v < 0
                      ? `L${Math.round((v + 1) * 50)}`
                      : `R${Math.round(v * 50)}`
                }
                ariaLabel="Pan"
              />

              {/* Delay Send Control */}
              {onPropertyChange && (
                <PropertySlider
                  label="Delay Send"
                  id="note-delay-send"
                  value={currentDelaySend !== undefined ? currentDelaySend : 0}
                  onChange={(v) => onPropertyChange?.("delaySend", v)}
                  valueFormatter={() =>
                    currentDelaySend !== undefined
                      ? `${Math.round(currentDelaySend * 100)}%`
                      : "OFF"
                  }
                  ariaLabel="Delay Send Control"
                />
              )}
              {/* Rhythmic Gate Parameters */}
              {trackType === "synth" && ( // or 'sampler' if you want both
                <div className="flex flex-col gap-2 mb-2 p-1.5 bg-gray-800/50 rounded border border-gray-700/50">
                  {/* Gate Depth */}
                  <div className="flex flex-col gap-1">
                    <div className="flex justify-between text-[10px] text-cyan-200/70 font-bold uppercase">
                      <label htmlFor="note-gate-depth">Gate Depth</label>
                      <span className="text-cyan-400 font-mono text-[10px] drop-shadow-[0_0_5px_rgba(34,211,238,0.5)]">
                        {Math.round(((currentGateDepth ?? 0) + 0.0001) * 100)}%
                      </span>
                    </div>
                    <input
                      id="note-gate-depth"
                      type="range"
                      min="0"
                      max="1"
                      step="0.01"
                      value={currentGateDepth ?? 0}
                      onChange={(e) =>
                        onPropertyChange(
                          "gateDepth",
                          parseFloat(e.target.value),
                        )
                      }
                      className="w-full h-2 bg-gray-900 rounded-lg appearance-none cursor-pointer accent-cyan-400 border border-cyan-900/30 hover:accent-cyan-300 transition-all"
                      aria-label="Gate Depth"
                    />
                  </div>

                  {/* Gate Rate */}
                  <div className="flex flex-col gap-1">
                    <div className="flex justify-between text-[10px] text-cyan-200/70 font-bold uppercase">
                      <label htmlFor="note-gate-rate">Gate Rate</label>
                      <span className="text-cyan-400 font-mono text-[10px]">
                        {(currentGateRate ?? 8).toFixed(1)} Hz
                      </span>
                    </div>
                    <input
                      id="note-gate-rate"
                      type="range"
                      min="0.5"
                      max="32"
                      step="0.1"
                      value={currentGateRate ?? 8}
                      onChange={(e) =>
                        onPropertyChange("gateRate", parseFloat(e.target.value))
                      }
                      className="w-full h-2 bg-gray-900 rounded-lg appearance-none cursor-pointer accent-cyan-400 border border-cyan-900/30 hover:accent-cyan-300 transition-all"
                      aria-label="Gate Rate"
                    />
                  </div>
                </div>
              )}
              {/* Reverb Send Control */}
              {onPropertyChange && (
                <>
                  <div className="flex flex-col gap-1 mt-2">
                    <div className="flex justify-between text-[10px] text-cyan-200/70 font-bold uppercase">
                      <label htmlFor="note-reverbsend">Reverb Send</label>
                      <span className="text-indigo-400 font-mono text-[10px] drop-shadow-[0_0_5px_rgba(129,140,248,0.5)]">
                        {currentReverbSend !== undefined
                          ? Math.round(currentReverbSend * 100)
                          : 0}
                        %
                      </span>
                    </div>
                    <input
                      id="note-reverbsend"
                      type="range"
                      min="0"
                      max="1"
                      step="0.01"
                      value={
                        currentReverbSend !== undefined ? currentReverbSend : 0
                      }
                      onChange={(e) =>
                        onPropertyChange?.(
                          "reverbSend",
                          parseFloat(e.target.value),
                        )
                      }
                      className="w-full h-2 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-indigo-400 border border-indigo-900/30 hover:accent-indigo-300 transition-all"
                      aria-valuetext={`${currentReverbSend !== undefined ? Math.round(currentReverbSend * 100) : 0}%`}
                      aria-label="Reverb Send"
                    />
                    <div className="flex justify-between items-center mt-1 mb-2">
                      <span className="text-[9px] text-indigo-200/50 uppercase font-bold">
                        Space
                      </span>
                      <select
                        value={currentReverbType || ""}
                        onChange={(e) =>
                          onPropertyChange?.("reverbType", e.target.value)
                        }
                        className="bg-gray-800/80 text-[10px] text-indigo-200 rounded border border-indigo-900/30 px-1 py-0.5 outline-none focus:border-indigo-500 transition-colors"
                        aria-label="Reverb Type Override"
                      >
                        <option value="">Global</option>
                        <option value="room">Room</option>
                        <option value="plate">Plate</option>
                        <option value="hall">Hall</option>
                      </select>
                    </div>
                    <div className="flex justify-between mb-1">
                      <span className="text-[10px] text-indigo-200/70 font-medium">
                        Reverb LFO Rate
                      </span>
                      <span className="text-[10px] text-indigo-300/90 tabular-nums">
                        {currentReverbLfoRate !== undefined
                          ? currentReverbLfoRate.toFixed(1)
                          : 0}{" "}
                        Hz
                      </span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="10"
                      step="0.1"
                      value={
                        currentReverbLfoRate !== undefined
                          ? currentReverbLfoRate
                          : 0
                      }
                      onChange={(e) =>
                        onPropertyChange?.(
                          "reverbLfoRate",
                          parseFloat(e.target.value),
                        )
                      }
                      className="w-full h-2 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-indigo-400 border border-indigo-900/30 hover:accent-indigo-300 transition-all"
                      aria-valuetext={`${currentReverbLfoRate !== undefined ? currentReverbLfoRate.toFixed(1) : 0} Hz`}
                      aria-label="Reverb LFO Rate"
                    />
                    <div className="flex justify-between mt-2 mb-1">
                      <span className="text-[10px] text-indigo-200/70 font-medium">
                        Reverb LFO Depth
                      </span>
                      <span className="text-[10px] text-indigo-300/90 tabular-nums">
                        {currentReverbLfoDepth !== undefined
                          ? Math.round(currentReverbLfoDepth * 100)
                          : 0}
                        %
                      </span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.01"
                      value={
                        currentReverbLfoDepth !== undefined
                          ? currentReverbLfoDepth
                          : 0
                      }
                      onChange={(e) =>
                        onPropertyChange?.(
                          "reverbLfoDepth",
                          parseFloat(e.target.value),
                        )
                      }
                      className="w-full h-2 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-indigo-400 border border-indigo-900/30 hover:accent-indigo-300 transition-all"
                      aria-valuetext={`${currentReverbLfoDepth !== undefined ? Math.round(currentReverbLfoDepth * 100) : 0}%`}
                      aria-label="Reverb LFO Depth"
                    />

                    <div className="mt-4 border-t border-indigo-500/20 pt-4">
                      <div className="flex justify-between mb-1">
                        <span className="text-[10px] text-indigo-200/70 font-medium">
                          Delay LFO Rate
                        </span>
                        <span className="text-[10px] text-indigo-300/90 tabular-nums">
                          {currentDelayLfoRate !== undefined
                            ? currentDelayLfoRate.toFixed(1)
                            : 0}{" "}
                          Hz
                        </span>
                      </div>
                      <input
                        type="range"
                        min="0.1"
                        max="10"
                        step="0.1"
                        value={
                          currentDelayLfoRate !== undefined
                            ? currentDelayLfoRate
                            : 0
                        }
                        onChange={(e) =>
                          onPropertyChange?.(
                            "delayLfoRate",
                            parseFloat(e.target.value),
                          )
                        }
                        className="w-full h-2 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-indigo-400 border border-indigo-900/30 hover:accent-indigo-300 transition-all"
                        aria-valuetext={`${currentDelayLfoRate !== undefined ? currentDelayLfoRate.toFixed(1) : 0} Hz`}
                        aria-label="Delay LFO Rate"
                      />
                      <div className="flex justify-between mt-2 mb-1">
                        <span className="text-[10px] text-indigo-200/70 font-medium">
                          Delay LFO Depth
                        </span>
                        <span className="text-[10px] text-indigo-300/90 tabular-nums">
                          {currentDelayLfoDepth !== undefined
                            ? Math.round(currentDelayLfoDepth * 100)
                            : 0}
                          %
                        </span>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.01"
                        value={
                          currentDelayLfoDepth !== undefined
                            ? currentDelayLfoDepth
                            : 0
                        }
                        onChange={(e) =>
                          onPropertyChange?.(
                            "delayLfoDepth",
                            parseFloat(e.target.value),
                          )
                        }
                        className="w-full h-2 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-indigo-400 border border-indigo-900/30 hover:accent-indigo-300 transition-all"
                        aria-valuetext={`${currentDelayLfoDepth !== undefined ? Math.round(currentDelayLfoDepth * 100) : 0}%`}
                        aria-label="Delay LFO Depth"
                      />
                    </div>
                  </div>

                  {/* Delay Send Control */}
                  <div className="flex flex-col gap-1 mt-2">
                    <div className="flex justify-between text-[10px] text-cyan-200/70 font-bold uppercase">
                      <label htmlFor="note-delaysend">Delay Send</label>
                      <span className="text-pink-400 font-mono text-[10px] drop-shadow-[0_0_5px_rgba(244,114,182,0.5)]">
                        {currentDelaySend !== undefined
                          ? Math.round(currentDelaySend * 100)
                          : 0}
                        %
                      </span>
                    </div>
                    <input
                      id="note-delaysend"
                      type="range"
                      min="0"
                      max="1"
                      step="0.01"
                      value={
                        currentDelaySend !== undefined ? currentDelaySend : 0
                      }
                      onChange={(e) =>
                        onPropertyChange(
                          "delaySend",
                          parseFloat(e.target.value),
                        )
                      }
                      className="w-full h-2 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-pink-400 border border-pink-900/30 hover:accent-pink-300 transition-all"
                      aria-valuetext={`${currentDelaySend !== undefined ? Math.round(currentDelaySend * 100) : 0}%`}
                      aria-label="Delay Send"
                    />
                  </div>

                  <div className="flex flex-col gap-1 mt-2">
                    <div className="flex justify-between text-[10px] text-cyan-200/70 font-bold uppercase">
                      <label htmlFor="note-choir">Chorus Spread</label>
                      <span className="text-indigo-400 font-mono text-[10px] drop-shadow-[0_0_5px_rgba(129,140,248,0.5)]">
                        {currentChoir !== undefined
                          ? Math.round(currentChoir * 100)
                          : 0}
                        %
                      </span>
                    </div>
                    <input
                      id="note-choir"
                      type="range"
                      min="0"
                      max="1"
                      step="0.01"
                      value={currentChoir !== undefined ? currentChoir : 0}
                      onChange={(e) =>
                        onPropertyChange("choir", parseFloat(e.target.value))
                      }
                      className="w-full h-2 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-indigo-400 border border-indigo-900/30 hover:accent-indigo-300 transition-all"
                      aria-valuetext={`${currentChoir !== undefined ? Math.round(currentChoir * 100) : 0}%`}
                      aria-label="Chorus Detune Spread"
                    />
                  </div>
                </>
              )}
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
                    <label className="text-[9px] text-gray-500 font-mono">
                      AMT
                    </label>
                    <input
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
                    <label className="text-[9px] text-gray-500 font-mono">
                      ATK
                    </label>
                    <input
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
                    <label className="text-[9px] text-gray-500 font-mono">
                      DEC
                    </label>
                    <input
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
                    <label>Formant Env Sync</label>
                    <button type="button"
                      role="switch"
                      aria-checked={currentFormantEnvSync || false}
                      aria-label="Sync Formant Envelope to BPM"
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


                        {/* Pan Control */}
                        <fieldset className="flex items-center justify-between group">
                            <legend className="sr-only">Pan Control</legend>
                            <div className="flex flex-col">
                                <label htmlFor="note-pan" className="text-xs font-bold font-orbitron text-cyan-400 group-hover:text-cyan-300 transition-colors drop-shadow-[0_0_5px_rgba(6,182,212,0.3)]">Pan</label>
                                <span className="text-cyan-400 font-mono text-[10px] drop-shadow-[0_0_5px_rgba(34,211,238,0.5)]">{currentPan !== undefined ? Math.round(currentPan * 100) : 0}%</span>
                            </div>
                            <input
                                id="note-pan"
                                type="range"
                                min="-1"
                                max="1"
                                step="0.05"
                                value={currentPan !== undefined ? currentPan : 0}
                                onChange={(e) => onPropertyChange?.('pan', parseFloat(e.target.value))}
                                className="w-24 h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-cyan-500 hover:accent-cyan-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#111827] shadow-[inset_0_1px_3px_rgba(0,0,0,0.5)]"
                                aria-label="Pan"
                            />
                        </fieldset>


                        {/* Pan Control */}
                        <fieldset className="flex items-center justify-between group">
                            <legend className="sr-only">Pan Control</legend>
                            <div className="flex flex-col">
                                <label htmlFor="note-pan" className="text-xs font-bold font-orbitron text-cyan-400 group-hover:text-cyan-300 transition-colors drop-shadow-[0_0_5px_rgba(6,182,212,0.3)]">Pan</label>
                                <span className="text-cyan-400 font-mono text-[10px] drop-shadow-[0_0_5px_rgba(34,211,238,0.5)]">{currentPan !== undefined ? Math.round(currentPan * 100) : 0}%</span>
                            </div>
                            <input
                                id="note-pan"
                                type="range"
                                min="-1"
                                max="1"
                                step="0.05"
                                value={currentPan !== undefined ? currentPan : 0}
                                onChange={(e) => onPropertyChange?.('pan', parseFloat(e.target.value))}
                                className="w-24 h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-cyan-500 hover:accent-cyan-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#111827] shadow-[inset_0_1px_3px_rgba(0,0,0,0.5)]"
                                aria-label="Pan"
                            />
                        </fieldset>

                                {/* Delay Send Control */}
                        {onPropertyChange && (
                            <fieldset className="flex flex-col gap-1 border-none p-0 m-0">
                                <legend className="sr-only">Delay Send Control</legend>
                                <div className="flex justify-between text-[10px] text-cyan-200/70 font-bold uppercase" aria-hidden="true">
                                    <label htmlFor="note-delay-send">Delay Send</label>
                                    <span className="text-indigo-400 font-mono text-[10px] drop-shadow-[0_0_5px_rgba(129,140,248,0.5)]">{currentDelaySend !== undefined ? Math.round(currentDelaySend * 100) : 0}%</span>
                                </div>
                                <input
                                    id="note-delay-send"
                                    type="range"
                                    min="0"
                                    max="1"
                                    step="0.01"
                                    value={currentDelaySend !== undefined ? currentDelaySend : 0}
                                    onChange={(e) => onPropertyChange('delaySend', parseFloat(e.target.value))}
                                    className="w-full h-2 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-indigo-400 border border-indigo-900/30 hover:accent-indigo-300 transition-all"
                                    aria-valuetext={`${currentDelaySend !== undefined ? Math.round(currentDelaySend * 100) : 0}%`}
                                    aria-label="Delay Send"
                                />
                            </fieldset>
                        )}
                        {/* Rhythmic Gate Parameters */}
                        {trackType === 'synth' && (   // or 'sampler' if you want both
                            <div className="flex flex-col gap-2 mb-2 p-1.5 bg-gray-800/50 rounded border border-gray-700/50">
                                {/* Gate Depth */}
                                <div className="flex flex-col gap-1">
                                    <div className="flex justify-between text-[10px] text-cyan-200/70 font-bold uppercase">
                                        <label htmlFor="note-gate-depth">Gate Depth</label>
                                        <span className="text-cyan-400 font-mono text-[10px] drop-shadow-[0_0_5px_rgba(34,211,238,0.5)]">
                                            {Math.round(((currentGateDepth ?? 0) + 0.0001) * 100)}%
                                        </span>
                                    </div>
                                    <input
                                        id="note-gate-depth"
                                        type="range"
                                        min="0"
                                        max="1"
                                        step="0.01"
                                        value={currentGateDepth ?? 0}
                                        onChange={(e) => onPropertyChange('gateDepth', parseFloat(e.target.value))}
                                        className="w-full h-2 bg-gray-900 rounded-lg appearance-none cursor-pointer accent-cyan-400 border border-cyan-900/30 hover:accent-cyan-300 transition-all"
                                        aria-label="Gate Depth"
                                    />
                                </div>

                                {/* Gate Rate */}
                                <div className="flex flex-col gap-1">
                                    <div className="flex justify-between text-[10px] text-cyan-200/70 font-bold uppercase">
                                        <label htmlFor="note-gate-rate">Gate Rate</label>
                                        <span className="text-cyan-400 font-mono text-[10px]">
                                            {(currentGateRate ?? 8).toFixed(1)} Hz
                                        </span>
                                    </div>
                                    <input
                                        id="note-gate-rate"
                                        type="range"
                                        min="0.5"
                                        max="32"
                                        step="0.1"
                                        value={currentGateRate ?? 8}
                                        onChange={(e) => onPropertyChange('gateRate', parseFloat(e.target.value))}
                                        className="w-full h-2 bg-gray-900 rounded-lg appearance-none cursor-pointer accent-cyan-400 border border-cyan-900/30 hover:accent-cyan-300 transition-all"
                                        aria-label="Gate Rate"
                                    />
                                </div>
                            </div>
                        )}
                        {/* Reverb Send Control */}
                        {onPropertyChange && (
                            <>
                                <div className="flex flex-col gap-1 mt-2">
                                    <div className="flex justify-between text-[10px] text-cyan-200/70 font-bold uppercase">
                                        <label htmlFor="note-reverbsend">Reverb Send</label>
                                        <span className="text-indigo-400 font-mono text-[10px] drop-shadow-[0_0_5px_rgba(129,140,248,0.5)]">{currentReverbSend !== undefined ? Math.round(currentReverbSend * 100) : 0}%</span>
                                    </div>
                                    <input
                                        id="note-reverbsend"
                                        type="range"
                                        min="0"
                                        max="1"
                                        step="0.01"
                                        value={currentReverbSend !== undefined ? currentReverbSend : 0}
                                        onChange={(e) => onPropertyChange?.('reverbSend', parseFloat(e.target.value))}
                                        className="w-full h-2 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-indigo-400 border border-indigo-900/30 hover:accent-indigo-300 transition-all"
                                        aria-valuetext={`${currentReverbSend !== undefined ? Math.round(currentReverbSend * 100) : 0}%`}
                                        aria-label="Reverb Send"
                                    />
                                    <div className="flex justify-between items-center mt-1 mb-2">
                                        <span className="text-[9px] text-indigo-200/50 uppercase font-bold">Space</span>
                                        <select
                                            value={currentReverbType || ''}
                                            onChange={(e) => onPropertyChange?.('reverbType', e.target.value)}
                                            className="bg-gray-800/80 text-[10px] text-indigo-200 rounded border border-indigo-900/30 px-1 py-0.5 outline-none focus:border-indigo-500 transition-colors"
                                            aria-label="Reverb Type Override"
                                        >
                                            <option value="">Global</option>
                                            <option value="room">Room</option>
                                            <option value="plate">Plate</option>
                                            <option value="hall">Hall</option>
                                        </select>
                                    </div>
                                    <div className="flex justify-between mb-1">
                                        <span className="text-[10px] text-indigo-200/70 font-medium">Reverb LFO Rate</span>
                                        <span className="text-[10px] text-indigo-300/90 tabular-nums">
                                            {currentReverbLfoRate !== undefined ? currentReverbLfoRate.toFixed(1) : 0} Hz
                                        </span>
                                    </div>
                                    <input
                                        type="range"
                                        min="0"
                                        max="10"
                                        step="0.1"
                                        value={currentReverbLfoRate !== undefined ? currentReverbLfoRate : 0}
                                        onChange={(e) => onPropertyChange?.('reverbLfoRate', parseFloat(e.target.value))}
                                        className="w-full h-2 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-indigo-400 border border-indigo-900/30 hover:accent-indigo-300 transition-all"
                                        aria-valuetext={`${currentReverbLfoRate !== undefined ? currentReverbLfoRate.toFixed(1) : 0} Hz`}
                                        aria-label="Reverb LFO Rate"
                                    />
                                    <div className="flex justify-between mt-2 mb-1">
                                        <span className="text-[10px] text-indigo-200/70 font-medium">Reverb LFO Depth</span>
                                        <span className="text-[10px] text-indigo-300/90 tabular-nums">
                                            {currentReverbLfoDepth !== undefined ? Math.round(currentReverbLfoDepth * 100) : 0}%
                                        </span>
                                    </div>
                                    <input
                                        type="range"
                                        min="0"
                                        max="1"
                                        step="0.01"
                                        value={currentReverbLfoDepth !== undefined ? currentReverbLfoDepth : 0}
                                        onChange={(e) => onPropertyChange?.('reverbLfoDepth', parseFloat(e.target.value))}
                                        className="w-full h-2 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-indigo-400 border border-indigo-900/30 hover:accent-indigo-300 transition-all"
                                        aria-valuetext={`${currentReverbLfoDepth !== undefined ? Math.round(currentReverbLfoDepth * 100) : 0}%`}
                                        aria-label="Reverb LFO Depth"
                                    />
                                </div>


                                {/* Delay Send Control */}
                                <div className="flex flex-col gap-1 mt-2">
                                    <div className="flex justify-between text-[10px] text-cyan-200/70 font-bold uppercase">
                                        <label htmlFor="note-delaysend">Delay Send</label>
                                        <span className="text-pink-400 font-mono text-[10px] drop-shadow-[0_0_5px_rgba(244,114,182,0.5)]">{currentDelaySend !== undefined ? Math.round(currentDelaySend * 100) : 0}%</span>
                                    </div>
                                    <input
                                        id="note-delaysend"
                                        type="range"
                                        min="0"
                                        max="1"
                                        step="0.01"
                                        value={currentDelaySend !== undefined ? currentDelaySend : 0}
                                        onChange={(e) => onPropertyChange('delaySend', parseFloat(e.target.value))}
                                        className="w-full h-2 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-pink-400 border border-pink-900/30 hover:accent-pink-300 transition-all"
                                        aria-valuetext={`${currentDelaySend !== undefined ? Math.round(currentDelaySend * 100) : 0}%`}
                                        aria-label="Delay Send"
                                    />
                                </div>

                                <div className="flex flex-col gap-1 mt-2">
                                    <div className="flex justify-between text-[10px] text-cyan-200/70 font-bold uppercase">
                                        <label htmlFor="note-choir">Chorus Spread</label>
                                        <span className="text-indigo-400 font-mono text-[10px] drop-shadow-[0_0_5px_rgba(129,140,248,0.5)]">{currentChoir !== undefined ? Math.round(currentChoir * 100) : 0}%</span>
                                    </div>
                                    <input
                                        id="note-choir"
                                        type="range"
                                        min="0"
                                        max="1"
                                        step="0.01"
                                        value={currentChoir !== undefined ? currentChoir : 0}
                                        onChange={(e) => onPropertyChange('choir', parseFloat(e.target.value))}
                                        className="w-full h-2 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-indigo-400 border border-indigo-900/30 hover:accent-indigo-300 transition-all"
                                        aria-valuetext={`${currentChoir !== undefined ? Math.round(currentChoir * 100) : 0}%`}
                                        aria-label="Chorus Detune Spread"
                                    />
                                </div>
                            </>
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

              {/* ── Prophecy-specific controls ─────────────────────── */}
              {isProphecy && onPropertyChange && (
                <>
                  {/* Vowel Select */}
                  <fieldset className="flex flex-col gap-1 border-none p-0 m-0">
                    <legend className="text-[10px] text-cyan-200/70 font-bold uppercase">
                      Vowel (Prophecy)
                    </legend>
                    <div
                      role="group"
                      aria-label="Prophecy vowel formant"
                      className="flex gap-1"
                    >
                      {(["A", "E", "I", "O", "U"] as const).map(
                        (label, idx) => (
                          <button type="button"
                            key={label}
                            onClick={() => onPropertyChange("vowel", idx)}
                            aria-pressed={Math.round(currentVowel) === idx}
                            aria-label={`Vowel ${label}`}
                            className={`flex-1 py-1 text-[10px] font-bold rounded transition-all ${
                              Math.round(currentVowel) === idx
                                ? "bg-cyan-600 text-white shadow-[0_0_10px_rgba(6,182,212,0.4)]"
                                : "bg-gray-800/80 text-cyan-200/70 hover:bg-gray-700 hover:text-white border border-gray-700/50"
                            }`}
                          >
                            {label}
                          </button>
                        ),
                      )}
                    </div>
                  </fieldset>

                  {/* Portamento */}
                  <div className="flex flex-col gap-1">
                    <div className="flex justify-between text-[10px] text-cyan-200/70 font-bold uppercase">
                      <label htmlFor="note-portamento">
                        Portamento (Prophecy)
                      </label>
                      <span className="text-cyan-400 font-mono text-[10px] drop-shadow-[0_0_5px_rgba(34,211,238,0.5)]">
                        {Math.round(currentPortamento * 100)}%
                      </span>
                    </div>
                    <input
                      id="note-portamento"
                      type="range"
                      min="0"
                      max="1"
                      step="0.01"
                      value={currentPortamento}
                      onChange={(e) =>
                        onPropertyChange(
                          "portamento",
                          parseFloat(e.target.value),
                        )
                      }
                      className="w-full h-2 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-cyan-400 border border-cyan-900/30 hover:accent-cyan-300 transition-all"
                      aria-valuetext={`${Math.round(currentPortamento * 100)}%`}
                      aria-label="Portamento"
                    />
                  </div>
                </>
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

              {/* Spectral & Time Group */}
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
          )}

          <div className="flex gap-2">
            {octaves.map((octave) => (
              <div key={octave} className="flex flex-col gap-1">
                {NOTES.slice()
                  .reverse()
                  .map((noteName) => {
                    const fullNote = `${noteName}${octave}`;
                    const color = getNoteColor(fullNote);
                    const isSelected = fullNote === currentNote;
                    const isInScale = scaleNotes
                      ? scaleNotes.has(noteName)
                      : true;

                    return (
                      <button type="button"
                        key={fullNote}
                        onClick={() => isInScale && onSelect(fullNote)}
                        aria-label={`Select ${fullNote}`}
                        aria-pressed={isSelected}
                        aria-disabled={!isInScale}
                        className={`w-8 h-6 text-[10px] font-mono rounded flex items-center justify-center transition-all ${isInScale ? "hover:scale-110" : "cursor-not-allowed"}`}
                        style={{
                          backgroundColor: isSelected
                            ? "#fff"
                            : isInScale
                              ? color
                              : "#333",
                          color: isSelected
                            ? "#000"
                            : !isInScale
                              ? "#666"
                              : ["C#", "D#", "F#", "G#", "A#"].includes(
                                    noteName,
                                  )
                                ? "#ccc"
                                : "#000",
                          border: isSelected ? `2px solid ${color}` : "none",
                          boxShadow: isSelected
                            ? "0 0 8px rgba(255,255,255,0.5)"
                            : "none",
                          opacity: isInScale ? 1 : 0.35,
                        }}
                      >
                        {noteName}
                      </button>
                    );
                  })}
                <div className="text-center text-[9px] text-cyan-800 font-bold mt-1">
                  OCT {octave}
                </div>
              </div>
            ))}
          </div>
        </div>
      </>
    );
  },
);
