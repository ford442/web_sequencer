import React from "react";
import { PropertySlider } from "./PropertySlider";
import type { PropertyChangeKey } from "./types";

export interface EffectsSendPropertiesProps {
  trackType: "synth" | "drum" | "voice";
  onPropertyChange: (key: PropertyChangeKey, value: number | boolean | string) => void;
  currentPan?: number;
  currentDelaySend?: number;
  currentGateDepth?: number;
  currentGateRate?: number;
  currentReverbSend?: number;
  currentReverbType?: import("../../types").ReverbType;
  currentReverbLfoRate?: number;
  currentReverbLfoDepth?: number;
  currentDelayLfoRate?: number;
  currentDelayLfoDepth?: number;
  currentChoir?: number;
}

export const EffectsSendProperties: React.FC<EffectsSendPropertiesProps> = React.memo(({
  trackType,
  onPropertyChange,
  currentPan,
  currentDelaySend,
  currentGateDepth = 0,
  currentGateRate = 8,
  currentReverbSend,
  currentReverbType,
  currentReverbLfoRate,
  currentReverbLfoDepth,
  currentDelayLfoRate,
  currentDelayLfoDepth,
  currentChoir,
}) => {
  return (
    <>
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
                className="bg-gray-800/80 text-[10px] text-indigo-200 rounded border border-indigo-900/30 px-1 py-0.5 outline-none focus-visible:border-indigo-500 transition-colors"
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
    </>
  );
});
