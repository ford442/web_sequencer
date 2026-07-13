import React from "react";
import type { PropertyChangeKey } from "./types";

export interface ProphecyPropertiesProps {
  onPropertyChange: (key: PropertyChangeKey, value: number | boolean | string) => void;
  currentVowel?: number;
  currentPortamento?: number;
}

export const ProphecyProperties: React.FC<ProphecyPropertiesProps> = React.memo(({
  onPropertyChange,
  currentVowel = 0,
  currentPortamento = 0,
}) => {
  return (
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
          {(["A", "E", "I", "O", "U"] as const).map((label, idx) => (
            <button
              type="button"
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
          ))}
        </div>
      </fieldset>

      {/* Portamento */}
      <div className="flex flex-col gap-1">
        <div className="flex justify-between text-[10px] text-cyan-200/70 font-bold uppercase">
          <label htmlFor="note-portamento">Portamento (Prophecy)</label>
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
            onPropertyChange("portamento", parseFloat(e.target.value))
          }
          className="w-full h-2 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-cyan-400 border border-cyan-900/30 hover:accent-cyan-300 transition-all"
          aria-valuetext={`${Math.round(currentPortamento * 100)}%`}
          aria-label="Portamento"
        />
      </div>
    </>
  );
});
