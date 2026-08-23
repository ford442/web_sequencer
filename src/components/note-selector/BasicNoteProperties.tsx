import React from "react";
import { PropertySlider } from "./PropertySlider";
import type { PropertyChangeKey } from "./types";

export interface BasicNotePropertiesProps {
  currentLength: number;
  onLengthChange: (length: number) => void;
  onPropertyChange?: (
    key: PropertyChangeKey,
    value: number | boolean | string,
  ) => void;
  currentVelocity?: number;
  currentTimbre?: number;
  currentProbability?: number;
  currentMicrotiming?: number;
  currentReverse?: boolean;
}

export const BasicNoteProperties: React.FC<BasicNotePropertiesProps> =
  React.memo(
    ({
      currentLength,
      onLengthChange,
      onPropertyChange,
      currentVelocity = 1,
      currentTimbre = 0,
      currentProbability = 1,
      currentMicrotiming = 0,
      currentReverse = false,
    }) => {
      return (
        <>
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
              />
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
              />
              {/* Reverse Control */}
              <div className="flex items-center justify-between group pt-1">
                <label
                  htmlFor="note-reverse"
                  className="text-xs font-semibold text-gray-300 group-hover:text-cyan-400 transition-colors"
                >
                  Reverse
                </label>
                <button
                  id="note-reverse"
                  type="button"
                  role="switch"
                  aria-checked={currentReverse}
                  onClick={() => onPropertyChange?.("reverse", !currentReverse)}
                  className={`w-8 h-4 rounded-full transition-colors relative focus:outline-none focus-visible:ring-2 focus:ring-cyan-500 ${
                    currentReverse ? "bg-cyan-500" : "bg-gray-700"
                  }`}
                >
                  <div
                    className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white transition-transform ${
                      currentReverse ? "translate-x-4" : "translate-x-0"
                    }`}
                  />
                </button>
              </div>
            </>
          )}
        </>
      );
    },
  );
