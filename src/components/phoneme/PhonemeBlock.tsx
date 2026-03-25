import React, { useState, useRef, useCallback, memo } from 'react';
import type { PhonemeData } from '../../types';
import { PHONEME_NAMES, getPhonemeColor } from '../../constants/phonemes';

export interface PhonemeBlockProps {
  phoneme: PhonemeData;
  index: number;
  isSelected: boolean;
  pixelsPerUnit: number;
  timelineWidth: number;
  onDrag: (id: string, deltaX: number) => void;
  onResizeStart: (id: string, side: 'left' | 'right') => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onPitchBendChange: (id: string, bend: number) => void;
}

export const PhonemeBlock = memo(({
  phoneme,
  index,
  isSelected,
  pixelsPerUnit,
  timelineWidth,
  onDrag,
  onResizeStart,
  onSelect,
  onDelete,
  onPitchBendChange
}: PhonemeBlockProps) => {
  const [isDragging, setIsDragging] = useState(false);
  const dragStartX = useRef(0);
  const dragStartLeft = useRef(0);
  const color = getPhonemeColor(phoneme.symbol);
  const displayName = PHONEME_NAMES[phoneme.symbol.toUpperCase()] || phoneme.symbol;

  // Calculate position
  const left = phoneme.start * timelineWidth;
  const width = Math.max(24, (phoneme.end - phoneme.start) * timelineWidth);
  const pitchPercent = 50 - (phoneme.pitchBend / 200) * 50; // Map -100..+100 to 100%..0%

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const target = e.currentTarget as Element;
    target.setPointerCapture(e.pointerId);

    dragStartX.current = e.clientX;
    dragStartLeft.current = phoneme.start;
    setIsDragging(true);
    onSelect(phoneme.id);

    const handlePointerMove = (ev: PointerEvent) => {
      const deltaX = ev.clientX - dragStartX.current;
      onDrag(phoneme.id, deltaX);
    };

    const handlePointerUp = (ev: PointerEvent) => {
      document.removeEventListener('pointermove', handlePointerMove);
      document.removeEventListener('pointerup', handlePointerUp);
      target.releasePointerCapture(ev.pointerId);
      setIsDragging(false);
    };

    document.addEventListener('pointermove', handlePointerMove);
    document.addEventListener('pointerup', handlePointerUp);
  }, [phoneme.id, phoneme.start, onDrag, onSelect]);

  return (
    <div
      className={`absolute top-8 h-16 rounded-lg flex flex-col overflow-hidden select-none transition-all duration-100 ${
        isSelected
          ? 'ring-2 ring-cyan-400 z-20'
          : 'hover:ring-1 hover:ring-white/30 z-10'
      } ${isDragging ? 'cursor-grabbing opacity-90' : 'cursor-grab'}`}
      style={{
        left,
        width,
        background: `linear-gradient(180deg, ${color}50 0%, ${color}30 40%, ${color}10 100%)`,
        border: `1px solid ${color}`,
        boxShadow: isSelected
          ? `0 0 20px ${color}60, inset 0 1px 0 rgba(255,255,255,0.15), 0 4px 12px rgba(0,0,0,0.4)`
          : `0 2px 8px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.08)`
      }}
    >
      {/* Main block content */}
      <div
        className="flex-1 flex flex-col items-center justify-center relative"
        onPointerDown={handlePointerDown}
      >
        {/* Glossy highlight overlay */}
        <div className="absolute inset-0 bg-gradient-to-b from-white/10 to-transparent pointer-events-none" />

        {/* Phoneme symbol */}
        <span className="text-xs font-bold text-white font-mono drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)] tracking-wider relative z-10">
          {phoneme.symbol}
        </span>

        {/* Phoneme name */}
        <span className="text-[9px] text-white/70 font-mono relative z-10">
          {displayName}
        </span>

        {/* Pitch bend indicator with LED style */}
        {phoneme.pitchBend !== 0 && (
          <span className={`text-[8px] font-mono mt-0.5 px-1 py-0.5 rounded bg-black/30 border ${phoneme.pitchBend > 0 ? 'text-cyan-400 border-cyan-500/30' : 'text-purple-400 border-purple-500/30'}`}>
            {phoneme.pitchBend > 0 ? '▲' : '▼'}{Math.abs(phoneme.pitchBend)}¢
          </span>
        )}

        {/* Delete button - hardware style */}
        {isSelected && (
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(phoneme.id); }}
            className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-gradient-to-b from-red-500 to-red-600 hover:from-red-400 hover:to-red-500 text-white text-xs flex items-center justify-center shadow-lg border border-red-400/50 transition-all"
            title="Delete phoneme"
            aria-label="Delete phoneme"
          >
            ×
          </button>
        )}
      </div>

      {/* Resize handles - improved visibility */}
      {isSelected && (
        <>
          <div
            className="absolute left-0 top-0 bottom-0 w-4 cursor-ew-resize bg-gradient-to-r from-white/25 to-transparent hover:from-white/40 transition-all flex items-center justify-center group"
            onPointerDown={(e) => { e.stopPropagation(); onResizeStart(phoneme.id, 'left'); }}
          >
            <div className="w-1 h-6 bg-white/60 rounded-full shadow-sm group-hover:bg-white/80 transition-colors" />
          </div>
          <div
            className="absolute right-0 top-0 bottom-0 w-4 cursor-ew-resize bg-gradient-to-l from-white/25 to-transparent hover:from-white/40 transition-all flex items-center justify-center group"
            onPointerDown={(e) => { e.stopPropagation(); onResizeStart(phoneme.id, 'right'); }}
          >
            <div className="w-1 h-6 bg-white/60 rounded-full shadow-sm group-hover:bg-white/80 transition-colors" />
          </div>
        </>
      )}

      {/* Pitch bend visualization - mini bar with glow */}
      <div className="absolute right-1 top-1 bottom-1 w-1.5 bg-black/50 rounded-full overflow-hidden border border-white/10">
        <div
          className="absolute left-0 right-0 bg-gradient-to-b from-cyan-400 via-purple-400 to-pink-400 rounded-full transition-all shadow-[0_0_6px_rgba(168,85,247,0.6)]"
          style={{
            top: `${Math.min(100, Math.max(0, pitchPercent))}%`,
            bottom: `${Math.min(100, Math.max(0, 100 - pitchPercent))}%`,
            height: phoneme.pitchBend === 0 ? '2px' : undefined
          }}
        />
        {/* Center marker */}
        <div className="absolute left-0 right-0 top-1/2 h-px bg-white/30" />
      </div>
    </div>
  );
});
