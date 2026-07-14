import React from "react";
import { PropertySlider } from "./PropertySlider";
import type { PropertyChangeKey } from "./types";

export interface BasicNotePropertiesProps {
  currentLength: number;
  onLengthChange: (length: number) => void;
  onPropertyChange?: (key: PropertyChangeKey, value: number | boolean | string) => void;
  currentVelocity?: number;
  currentTimbre?: number;
  currentProbability?: number;
  currentMicrotiming?: number;
}

export const BasicNoteProperties: React.FC<BasicNotePropertiesProps> = React.memo(({
  currentLength,
  onLengthChange,
  onPropertyChange,
  currentVelocity = 1,
  currentTimbre = 0,
  currentProbability = 1,
  currentMicrotiming = 0,
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
        </>
      )}
    </>
  );
});
