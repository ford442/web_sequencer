import React, { memo, useMemo } from 'react';
import cppPanel from '../assets/panels/cpp-panel.jpg';
import { MagicKnob } from './MagicKnob';
import type { Waveform } from '../types';

/** CPP oscillator waveforms in knob order: sinf → sawtooth → square → rand */
export const CPP_WAVEFORMS = ['cpp-sin', 'cpp-saw', 'cpp-sqr', 'cpp-rand'] as const satisfies readonly Waveform[];

export const CPP_FUNCTION_LABELS = ['SIN', 'SAW', 'SQR', 'RND'] as const;

export function waveformToCppFunctionIndex(waveform: Waveform): number {
  const idx = CPP_WAVEFORMS.indexOf(waveform as (typeof CPP_WAVEFORMS)[number]);
  return idx >= 0 ? idx : 1;
}

export function cppFunctionIndexToWaveform(index: number): Waveform {
  const clamped = Math.max(0, Math.min(CPP_WAVEFORMS.length - 1, Math.round(index)));
  return CPP_WAVEFORMS[clamped];
}

interface CppPanelProps {
  waveform: Waveform;
  fine?: number;
  accentColor?: 'pink' | 'cyan';
  onWaveformChange: (waveform: Waveform) => void;
  onFineChange: (value: number) => void;
}

/**
 * Overlay panel for the high-precision C++ oscillator family.
 * Two holographic knobs sit over the panel image wells:
 *  - Function: sinf / sawtooth / square / rand
 *  - Fine: detune / shape (0–1)
 */
export const CppPanel: React.FC<CppPanelProps> = memo(({
  waveform,
  fine = 0.5,
  accentColor = 'cyan',
  onWaveformChange,
  onFineChange,
}) => {
  const functionIndex = waveformToCppFunctionIndex(waveform);
  const functionLabel = CPP_FUNCTION_LABELS[functionIndex] ?? 'SAW';

  const borderColor = accentColor === 'cyan' ? 'border-cyan-500/25' : 'border-pink-500/25';
  const labelColor = accentColor === 'cyan' ? 'text-cyan-300/80' : 'text-pink-300/80';

  const functionKnobValue = useMemo(
    () => functionIndex / (CPP_WAVEFORMS.length - 1),
    [functionIndex],
  );

  return (
    <div
      className={`cpp-panel rounded-lg overflow-hidden border ${borderColor} bg-zinc-950/90 shadow-[0_0_20px_rgba(217,70,239,0.15)]`}
      role="group"
      aria-label="CPP high-precision oscillator"
    >
      <div className="relative w-[240px]" style={{ lineHeight: 0 }}>
        <img
          src={cppPanel}
          alt="CPP oscillator panel"
          className="block w-full h-auto select-none pointer-events-none"
          draggable={false}
        />

        {/* Live function readout */}
        <div
          className={`absolute top-[14%] left-1/2 -translate-x-1/2 text-[9px] font-mono font-bold tracking-[0.2em] ${labelColor} pointer-events-none`}
          aria-hidden="true"
        >
          {functionLabel}
        </div>

        {/* Function selector — left well */}
        <div
          className="absolute pointer-events-auto"
          style={{ left: '14%', top: '58%', width: '28%', transform: 'translate(-0%, -50%)' }}
        >
          <MagicKnob
            label="FN"
            size={56}
            min={0}
            max={CPP_WAVEFORMS.length - 1}
            value={functionIndex}
            onChange={(v) => onWaveformChange(cppFunctionIndexToWaveform(v))}
          />
        </div>

        {/* Fine param — right well */}
        <div
          className="absolute pointer-events-auto"
          style={{ left: '58%', top: '58%', width: '28%', transform: 'translate(-0%, -50%)' }}
        >
          <MagicKnob
            label="FINE"
            size={56}
            min={0}
            max={1}
            value={fine}
            onChange={onFineChange}
          />
        </div>
      </div>

      <div className={`px-2 py-1 flex justify-between text-[7px] font-mono uppercase tracking-wider ${labelColor}`}>
        <span>fn: {functionLabel}</span>
        <span>fine: {(fine * 100).toFixed(0)}%</span>
        <span className="sr-only">Function knob at {Math.round(functionKnobValue * 100)}%</span>
      </div>
    </div>
  );
});

CppPanel.displayName = 'CppPanel';
