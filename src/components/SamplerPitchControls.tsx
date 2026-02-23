import React from 'react';
import { Knob } from './Knob';

/**
 * SamplerPitchControls - Holographic pitch control panel for vocal workstation
 * 
 * Phase 1 of the Vocal Workstation implementation.
 * Provides comprehensive pitch, formant, and RubberBand engine controls.
 */

export interface PitchControlValues {
  rootNote: number;
  coarse: number;
  fine: number;
  formant: number;
  pitchAttack: number;
  pitchDecay: number;
  rbQuality: 'Fast' | 'Standard' | 'Elastic';
  stretchMode: 'Time' | 'Pitch' | 'Formant';
  autoFollow: boolean;
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

const VerticalMiniLadder: React.FC<VerticalMiniLadderProps> = ({ selected, onSelect }) => {
  // Show 12 notes centered around selected
  const startNote = Math.max(36, Math.min(selected - 6, 96));
  const notes = Array.from({ length: 12 }, (_, i) => startNote + i);
  
  return (
    <div className="flex flex-col gap-0.5 h-32 overflow-y-auto scrollbar-thin scrollbar-thumb-purple-500 scrollbar-track-transparent">
      {notes.map((note) => {
        const isSelected = note === selected;
        const isC = note % 12 === 0;
        return (
          <button
            key={note}
            onClick={() => onSelect(note)}
            className={`text-[10px] font-mono py-0.5 px-2 rounded transition-all ${
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
};

export const SamplerPitchControls: React.FC<SamplerPitchControlsProps> = ({
  bankId,
  values,
  onChange,
}) => {
  return (
    <div className="bg-gradient-to-br from-gray-900/80 to-indigo-950/50 border border-purple-500/30 rounded-lg p-4 space-y-4 shadow-lg">
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
        <div className="col-span-7 grid grid-cols-4 gap-2">
          <div className="flex flex-col items-center">
            <Knob
              label="COARSE"
              value={values.coarse}
              min={-24}
              max={24}
              step={1}
              color="purple"
              onChange={(v) => onChange('coarse', v)}
            />
            <span className="text-[10px] text-gray-500 mt-1">st</span>
          </div>

          <div className="flex flex-col items-center">
            <Knob
              label="FINE"
              value={values.fine}
              min={-50}
              max={50}
              step={1}
              color="purple"
              onChange={(v) => onChange('fine', v)}
            />
            <span className="text-[10px] text-gray-500 mt-1">¢</span>
          </div>

          <div className="flex flex-col items-center">
            <Knob
              label="FORMANT"
              value={values.formant}
              min={-12}
              max={12}
              step={0.5}
              color="indigo"
              onChange={(v) => onChange('formant', v)}
            />
            <span className="text-[10px] text-gray-500 mt-1">st</span>
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex flex-col items-center">
              <Knob
                label="ATTACK"
                value={values.pitchAttack}
                min={0}
                max={2000}
                step={10}
                size="sm"
                color="cyan"
                onChange={(v) => onChange('pitchAttack', v)}
              />
              <span className="text-[9px] text-gray-500">ms</span>
            </div>
            <div className="flex flex-col items-center">
              <Knob
                label="DECAY"
                value={values.pitchDecay}
                min={0}
                max={2000}
                step={10}
                size="sm"
                color="cyan"
                onChange={(v) => onChange('pitchDecay', v)}
              />
              <span className="text-[9px] text-gray-500">ms</span>
            </div>
          </div>
        </div>

        {/* RubberBand Engine Section */}
        <div className="col-span-3 flex flex-col gap-2">
          <label className="text-[10px] text-white/70 uppercase tracking-wide">
            RubberBand Engine
          </label>
          
          {/* Quality Select */}
          <div className="flex flex-col gap-1">
            <label className="text-[9px] text-gray-500">Quality</label>
            <select
              value={values.rbQuality}
              onChange={(e) => onChange('rbQuality', e.target.value as 'Fast' | 'Standard' | 'Elastic')}
              className="bg-gray-800 border border-gray-700 text-white text-[10px] rounded px-2 py-1 outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500"
            >
              <option value="Fast">Fast</option>
              <option value="Standard">Standard</option>
              <option value="Elastic">Elastic</option>
            </select>
          </div>

          {/* Stretch Mode Select */}
          <div className="flex flex-col gap-1">
            <label className="text-[9px] text-gray-500">Mode</label>
            <select
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
          <label className="flex items-center gap-2 text-[10px] text-gray-300 mt-1 cursor-pointer hover:text-white transition-colors">
            <input
              type="checkbox"
              checked={values.autoFollow}
              onChange={(e) => onChange('autoFollow', e.target.checked)}
              className="w-3 h-3 rounded border-gray-600 text-purple-600 focus:ring-purple-500 bg-gray-800"
            />
            <span className="leading-none">Lock to Seq</span>
          </label>
        </div>
      </div>

      {/* Pitch Display Bar */}
      <div className="flex items-center gap-2 pt-2 border-t border-white/10">
        <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-purple-600 via-indigo-500 to-cyan-500 transition-all duration-150"
            style={{
              width: `${Math.min(100, Math.max(0, ((values.coarse + 24) / 48) * 100))}%`,
            }}
          />
        </div>
        <span className="text-[10px] font-mono text-gray-400 w-16 text-right">
          {values.coarse >= 0 ? '+' : ''}{values.coarse}st
        </span>
      </div>
    </div>
  );
};

export default SamplerPitchControls;
