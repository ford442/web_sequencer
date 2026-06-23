import React, { memo, useCallback, useState } from 'react';
import type { DrumSound } from '../types';

interface DrumPadConfig {
  id: string;
  sound: DrumSound;
  label: string;
  color: string;
  inactiveBorder: string;
  hoverShadow: string;
  velocity: number;
}

const DRUM_PADS: DrumPadConfig[] = [
  { id: 'kick', sound: 'kick', label: 'KICK', color: 'bg-red-500', inactiveBorder: 'border-red-900/40', hoverShadow: 'hover:shadow-red-500/40', velocity: 1.0 },
  { id: 'snare', sound: 'snare', label: 'SNARE', color: 'bg-yellow-400', inactiveBorder: 'border-yellow-700/40', hoverShadow: 'hover:shadow-yellow-400/40', velocity: 1.0 },
  { id: 'closedHat', sound: 'closedHat', label: 'CH HAT', color: 'bg-cyan-500', inactiveBorder: 'border-cyan-800/40', hoverShadow: 'hover:shadow-cyan-500/40', velocity: 1.0 },
  { id: 'openHat', sound: 'openHat', label: 'OH HAT', color: 'bg-cyan-300', inactiveBorder: 'border-cyan-600/40', hoverShadow: 'hover:shadow-cyan-300/40', velocity: 1.0 },
  { id: 'kick-soft', sound: 'kick', label: 'KICK L', color: 'bg-red-400', inactiveBorder: 'border-red-900/30', hoverShadow: 'hover:shadow-red-400/30', velocity: 0.65 },
  { id: 'snare-soft', sound: 'snare', label: 'SNR L', color: 'bg-yellow-300', inactiveBorder: 'border-yellow-700/30', hoverShadow: 'hover:shadow-yellow-300/30', velocity: 0.7 },
  { id: 'closedHat-soft', sound: 'closedHat', label: 'CH L', color: 'bg-cyan-400', inactiveBorder: 'border-cyan-800/30', hoverShadow: 'hover:shadow-cyan-400/30', velocity: 0.55 },
  { id: 'openHat-soft', sound: 'openHat', label: 'OH L', color: 'bg-cyan-200', inactiveBorder: 'border-cyan-600/30', hoverShadow: 'hover:shadow-cyan-200/30', velocity: 0.75 },
];

export interface DrumPadsProps {
  onPlayDrum: (sound: DrumSound, velocity?: number) => void;
}

export const DrumPads = memo(({ onPlayDrum }: DrumPadsProps) => {
  const [activePads, setActivePads] = useState<Set<string>>(new Set());

  const handlePadDown = useCallback((pad: DrumPadConfig) => {
    setActivePads((prev) => new Set(prev).add(pad.id));
    onPlayDrum(pad.sound, pad.velocity);
  }, [onPlayDrum]);

  const handlePadUp = useCallback((padId: string) => {
    setActivePads((prev) => {
      const next = new Set(prev);
      next.delete(padId);
      return next;
    });
  }, []);

  return (
    <div className="bg-gray-900 border border-gray-700/50 rounded-xl p-4 shadow-2xl w-full max-w-md mx-auto">
      <div className="flex justify-between items-center mb-4 px-1">
        <h3 className="text-cyan-400 font-orbitron font-bold text-xs tracking-widest">LIVE PADS</h3>
        <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" aria-hidden="true" />
      </div>

      <div className="grid grid-cols-4 gap-3" role="group" aria-label="Live drum pads">
        {DRUM_PADS.map((pad) => {
          const isActive = activePads.has(pad.id);

          return (
            <button
              key={pad.id}
              type="button"
              aria-label={`Play ${pad.label}`}
              onMouseDown={() => handlePadDown(pad)}
              onMouseUp={() => handlePadUp(pad.id)}
              onMouseLeave={() => handlePadUp(pad.id)}
              onTouchStart={(e) => { e.preventDefault(); handlePadDown(pad); }}
              onTouchEnd={(e) => { e.preventDefault(); handlePadUp(pad.id); }}
              className={`
                relative flex items-center justify-center aspect-square rounded-lg
                font-bold text-[10px] tracking-wider select-none
                transition-all duration-75 outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900
                ${isActive
                  ? `${pad.color} text-black scale-95 shadow-[inset_0_0_15px_rgba(0,0,0,0.4)]`
                  : `bg-gray-800 text-gray-400 border-b-4 border-gray-950 ${pad.inactiveBorder} hover:bg-gray-700 ${pad.hoverShadow} hover:shadow-[0_0_15px_rgba(0,0,0,0.5)]`
                }
              `}
            >
              {pad.label}

              {isActive && (
                <div className={`absolute -inset-1 rounded-lg ${pad.color} opacity-30 blur-sm pointer-events-none`} aria-hidden="true" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
});

DrumPads.displayName = 'DrumPads';
