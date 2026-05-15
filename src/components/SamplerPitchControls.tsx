import React, { useRef } from 'react';
import { Knob } from './Knob';

/**
 * SamplerPitchControls - Holographic pitch control panel for vocal workstation
 * 
 * Phase 1 of the Vocal Workstation implementation.
 * Provides comprehensive pitch, formantShift, and RubberBand engine controls.
 */

export interface PitchControlValues {
  rootNote: number;
  coarseTuneTune: number;
  fineTuneTune: number;
  formantShiftShift: number;
  quality: 'preview' | 'good' | 'better' | 'best';
  stretchMode: 'Time' | 'Pitch' | 'Formant';
  lockToSequencer: boolean;
  pitchAttack?: number;
  pitchDecay?: number;
}

interface SamplerPitchControlsProps {
  bankId: number;
  values: PitchControlValues;
  onChange: (key: keyof PitchControlValues, value: number | string | boolean) => void;
}

// MIDI note names for display
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

const midiToNoteName = (midi: number): string => {
  const note = NOTE_NAMES[midi % 12];
  const octave = Math.floor(midi / 12) - 1;
  return `${note}${octave}`;
};

// VerticalMiniLadder component for root note selection
interface VerticalMiniLadderProps {
  selected: number;
  onSelect: (note: number) => void;
}

const VerticalMiniLadder: React.FC<VerticalMiniLadderProps> = React.memo(({ selected, onSelect }) => {
  // Show 12 notes centered around selected
  const startNote = Math.max(36, Math.min(selected - 6, 96));
  const notes = Array.from({ length: 12 }, (_, i) => startNote + i);
  const buttonRefs = useRef<Map<number, HTMLButtonElement>>(new Map());

  const handleKeyDown = (e: React.KeyboardEvent) => {
    let nextNote = selected;
    let handled = false;

    if (e.key === 'ArrowUp') {
      nextNote = selected - 1;
      handled = true;
    } else if (e.key === 'ArrowDown') {
      nextNote = selected + 1;
      handled = true;
    } else if (e.key === 'PageUp') {
      nextNote = selected - 12;
      handled = true;
    } else if (e.key === 'PageDown') {
      nextNote = selected + 12;
      handled = true;
    }

    if (handled) {
      e.preventDefault();
      const clamped = Math.max(36, Math.min(96, nextNote));
      if (clamped !== selected) {
        onSelect(clamped);
        // Focus the new button after render
        setTimeout(() => {
          const btn = buttonRefs.current.get(clamped);
          btn?.focus();
        }, 0);
      }
    }
  };
  
  return (
    <div
      className="flex flex-col gap-0.5 h-32 overflow-y-auto scrollbar-thin scrollbar-thumb-purple-500 scrollbar-track-transparent focus:outline-none"
      role="radiogroup"
      aria-label="Root Note Selection"
      onKeyDown={handleKeyDown}
    >
      {notes.map((note) => {
        const isSelected = note === selected;
        const isC = note % 12 === 0;
        return (
          <button
            key={note}
            ref={(el) => {
              if (el) buttonRefs.current.set(note, el);
              else buttonRefs.current.delete(note);
            }}
            role="radio"
            aria-checked={isSelected}
            tabIndex={isSelected ? 0 : -1}
            onClick={() => onSelect(note)}
            className={`text-[10px] font-mono py-0.5 px-2 rounded transition-all focus:outline-none focus:ring-2 focus:ring-purple-400 focus:ring-opacity-50 ${
              isSelected
                ? 'bg-purple-600 text-white shadow-[0_0_8px_rgba(147,51,234,0.6)]'
                : isC
                ? 'bg-gray-700 text-purple-300 hover:bg-gray-600'
                : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
            }`}
          >
            {midiToNoteName(note)}
          </button>
        );
      })}
    </div>
  );
});

// ⚡ Bolt: Added React.memo to prevent unnecessary re-renders when parent state changes.
export const SamplerPitchControls: React.FC<SamplerPitchControlsProps> = React.memo(({
  bankId,
  values,
  onChange,
}) => {
  // Generate unique IDs for form elements based on bankId
  const qualityId = `rb-quality-${bankId}`;
  const modeId = `rb-mode-${bankId}`;
  const lockToSequencerId = `rb-autofollow-${bankId}`;

  return (
    <div
      className="bg-gradient-to-br from-gray-900/80 to-indigo-950/50 border border-purple-500/30 rounded-lg p-4 space-y-4 shadow-lg"
      aria-label={`Vocal Pitch Engine for Bank ${bankId + 1}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/10 pb-2">
        <h3 className="text-xs font-bold text-purple-300 uppercase tracking-wider">
          Vocal Pitch Engine
        </h3>
        <span className="text-[10px] text-gray-500 font-mono">BANK {bankId + 1}</span>
      </div>

      <div className="grid grid-cols-12 gap-3">
        {/* Root Note Section */}
        <div className="col-span-2">
          <label className="text-[10px] text-white/70 block mb-1 uppercase tracking-wide">
            Root Note
          </label>
          <div className="bg-gray-900/50 rounded p-1 border border-white/5">
            <VerticalMiniLadder
              selected={values.rootNote}
              onSelect={(n) => onChange('rootNote', n)}
            />
          </div>
          <div className="text-center mt-1">
            <span className="text-xs font-bold text-purple-300 font-mono">
              {midiToNoteName(values.rootNote)}
            </span>
          </div>
        </div>

        {/* Pitch Knobs Row */}
        <div className="col-span-7 grid grid-cols-4 gap-2" role="group" aria-label="Pitch Adjustment Controls">
          <div className="flex flex-col items-center">
            <Knob
              label="COARSE"
              value={values.coarseTuneTune}
              min={-24}
              max={24}
              step={1}
              color="purple"
              onChange={(v) => onChange('coarseTuneTune', v)}
            />
            <span className="text-[10px] text-gray-500 mt-1">st</span>
          </div>

          <div className="flex flex-col items-center">
            <Knob
              label="FINE"
              value={values.fineTuneTune}
              min={-50}
              max={50}
              step={1}
              color="purple"
              onChange={(v) => onChange('fineTuneTune', v)}
            />
            <span className="text-[10px] text-gray-500 mt-1">¢</span>
          </div>

          <div className="flex flex-col items-center">
            <Knob
              label="FORMANT"
              value={values.formantShiftShift}
              min={-12}
              max={12}
              step={0.5}
              color="indigo"
              onChange={(v) => onChange('formantShiftShift', v)}
            />
            <span className="text-[10px] text-gray-500 mt-1">st</span>
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex flex-col items-center">
              <Knob
                label="ATTACK"
                value={values.attack}
                min={0}
                max={2000}
                step={10}
                color="cyan"
                onChange={(v) => onChange('attack', v)}
              />
              <span className="text-[9px] text-gray-500">ms</span>
            </div>
            <div className="flex flex-col items-center">
              <Knob
                label="DECAY"
                value={values.decay}
                min={0}
                max={2000}
                step={10}
                color="cyan"
                onChange={(v) => onChange('decay', v)}
              />
              <span className="text-[9px] text-gray-500">ms</span>
            </div>
          </div>
        </div>

        {/* RubberBand Engine Section */}
        <div className="col-span-3 flex flex-col gap-2" role="group" aria-label="RubberBand Engine Settings">
          <label className="text-[10px] text-white/70 uppercase tracking-wide">
            RubberBand Engine
          </label>
          
          {/* Quality Select */}
          <div className="flex flex-col gap-1">
            <label htmlFor={qualityId} className="text-[9px] text-gray-500">Quality</label>
            <select
              id={qualityId}
              value={values.quality}
              onChange={(e) => onChange('quality', e.target.value as 'preview' | 'good' | 'better' | 'best')}
              className="bg-gray-800 border border-gray-700 text-white text-[10px] rounded px-2 py-1 outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500"
            >
              <option value="Fast">Fast</option>
              <option value="Standard">Standard</option>
              <option value="Elastic">Elastic</option>
            </select>
          </div>

          {/* Stretch Mode Select */}
          <div className="flex flex-col gap-1">
            <label htmlFor={modeId} className="text-[9px] text-gray-500">Mode</label>
            <select
              id={modeId}
              value={values.stretchMode}
              onChange={(e) => onChange('stretchMode', e.target.value as 'Time' | 'Pitch' | 'Formant')}
              className="bg-gray-800 border border-gray-700 text-white text-[10px] rounded px-2 py-1 outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500"
            >
              <option value="Time">Time</option>
              <option value="Pitch">Pitch</option>
              <option value="Formant">Formant</option>
            </select>
          </div>

          {/* Auto Follow Checkbox */}
          <div
            className="flex items-center gap-2 mt-1 cursor-pointer"
            onClick={() => onChange('lockToSequencer', !values.lockToSequencer)}
          >
            <button
              type="button"
              role="switch"
              aria-checked={values.lockToSequencer}
              id={lockToSequencerId}
              onClick={(e) => {
                e.stopPropagation();
                onChange('lockToSequencer', !values.lockToSequencer);
              }}
              className={`relative inline-flex h-3 w-6 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 focus-visible:ring-offset-1 focus-visible:ring-offset-gray-900 ${
                values.lockToSequencer ? 'bg-purple-600' : 'bg-gray-800'
              }`}
              aria-labelledby={`${lockToSequencerId}-label`}
            >
              <span className="sr-only">Lock to Sequence</span>
              <span
                aria-hidden="true"
                className={`pointer-events-none inline-block h-2 w-2 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                  values.lockToSequencer ? 'translate-x-3' : 'translate-x-0'
                }`}
              />
            </button>
            <span id={`${lockToSequencerId}-label`} className="text-[10px] text-gray-300 hover:text-white transition-colors leading-none select-none">
              Lock to Seq
            </span>
          </div>
        </div>
      </div>

      {/* Pitch Display Bar */}
      <div className="flex items-center gap-2 pt-2 border-t border-white/10" aria-hidden="true">
        <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-purple-600 via-indigo-500 to-cyan-500 transition-all duration-150"
            style={{
              width: `${Math.min(100, Math.max(0, ((values.coarseTune + 24) / 48) * 100))}%`,
            }}
          />
        </div>
        <span className="text-[10px] font-mono text-gray-400 w-16 text-right">
          {values.coarseTune >= 0 ? '+' : ''}{values.coarseTune}st
        </span>
      </div>
    </div>
  );
});

export default SamplerPitchControls;
