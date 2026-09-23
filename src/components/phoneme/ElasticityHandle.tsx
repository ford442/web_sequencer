import React, { useCallback, useRef } from 'react';
import {
  ELASTICITY_DEFAULT,
  ELASTICITY_MAX,
  ELASTICITY_MIN,
  clampElasticity,
} from '@/engines/rubberband/phonemeElasticity';

/** Horizontal drag distance for the full 0.5 → 1.5 sweep. */
const PX_PER_FULL_RANGE = 120;

export interface ElasticityHandleProps {
  phonemeId: string;
  elasticity: number | undefined;
  /** Only the selected pill is draggable; others just show the amount. */
  interactive: boolean;
  onChange: (id: string, elasticity: number) => void;
}

/**
 * Squish / stretch strip along the bottom of a phoneme pill. The bar grows
 * right of centre when the phoneme takes more of the note (> 1) and left
 * when it gives time up (< 1). Dragging it is the pointer path; the painter
 * panel slider and the `[` / `]` keys are the keyboard path, so the strip
 * itself stays out of the tab order like the resize handles.
 */
export const ElasticityHandle: React.FC<ElasticityHandleProps> = ({ phonemeId, elasticity, interactive, onChange }) => {
  const value = clampElasticity(elasticity);
  const drag = useRef<{ x: number; start: number } | null>(null);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (!interactive) return;
    e.preventDefault();
    e.stopPropagation();
    const target = e.currentTarget as Element;
    target.setPointerCapture?.(e.pointerId);
    drag.current = { x: e.clientX, start: value };

    const handleMove = (ev: PointerEvent) => {
      if (!drag.current) return;
      const span = ELASTICITY_MAX - ELASTICITY_MIN;
      onChange(phonemeId, drag.current.start + ((ev.clientX - drag.current.x) / PX_PER_FULL_RANGE) * span);
    };
    const handleUp = (ev: PointerEvent) => {
      drag.current = null;
      target.releasePointerCapture?.(ev.pointerId);
      document.removeEventListener('pointermove', handleMove);
      document.removeEventListener('pointerup', handleUp);
    };
    document.addEventListener('pointermove', handleMove);
    document.addEventListener('pointerup', handleUp);
  }, [interactive, onChange, phonemeId, value]);

  const offset = (value - ELASTICITY_DEFAULT) / (ELASTICITY_MAX - ELASTICITY_DEFAULT); // -1..1
  const stretched = value > ELASTICITY_DEFAULT;

  return (
    <div
      className={`absolute left-4 right-4 bottom-0.5 h-2 rounded-full bg-black/50 border border-white/10 ${interactive ? 'cursor-ew-resize' : 'pointer-events-none'}`}
      data-testid={`elasticity-handle-${phonemeId}`}
      data-elasticity={value.toFixed(2)}
      title={interactive ? `Elasticity ${Math.round(value * 100)}% — drag to squish / stretch` : undefined}
      aria-hidden="true"
      onPointerDown={handlePointerDown}
    >
      <div className="absolute top-0 bottom-0 left-1/2 w-px bg-white/40" />
      {value !== ELASTICITY_DEFAULT && (
        <div
          className={`absolute top-0 bottom-0 rounded-full ${stretched ? 'bg-amber-400/80' : 'bg-sky-400/80'}`}
          style={stretched
            ? { left: '50%', width: `${offset * 50}%` }
            : { right: '50%', width: `${-offset * 50}%` }}
        />
      )}
      {interactive && (
        <div
          className="absolute top-1/2 w-2.5 h-2.5 -mt-[5px] -ml-[5px] rounded-full bg-white shadow"
          style={{ left: `${50 + offset * 50}%` }}
        />
      )}
    </div>
  );
};
