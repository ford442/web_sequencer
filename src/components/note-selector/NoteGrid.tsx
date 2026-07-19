import React from "react";
import { NOTES } from "../../utils/musicTheory";
import type { ScaleDefinition } from "../../utils/musicTheory";
import { getScaleNotes } from "../../utils/musicTheory";

export interface NoteGridProps {
  trackType: "synth" | "drum" | "voice";
  currentNote: string;
  currentScale?: ScaleDefinition | null;
  getNoteColor: (note: string) => string;
  onSelect: (note: string) => void;
}

export const NoteGrid: React.FC<NoteGridProps> = React.memo(({
  trackType,
  currentNote,
  currentScale,
  getNoteColor,
  onSelect,
}) => {
  const octaves = trackType === "synth" ? [2, 3, 4] : [2];
  const scaleNotes = currentScale ? getScaleNotes(currentScale) : null;

  return (
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
  );
});
