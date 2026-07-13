import React from "react";
import { PropertySlider } from "./PropertySlider";
import type { PropertyChangeKey } from "./types";

export interface VocoderPropertiesProps {
  onPropertyChange: (key: PropertyChangeKey, value: number | boolean | string) => void;
  currentVocoderMix?: number;
  currentVocoderFormantShift?: number;
  currentVocoderPreservation?: number;
}

export const VocoderProperties: React.FC<VocoderPropertiesProps> = React.memo(({
  onPropertyChange,
  currentVocoderMix,
  currentVocoderFormantShift,
  currentVocoderPreservation,
}) => {
  return (
    <>
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
    </>
  );
});
