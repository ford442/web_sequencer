// src/components/StepButton.tsx
import React, { useRef } from 'react';

interface StepButtonProps {
  isActive: boolean;
  isCurrent: boolean;
  onClick: () => void;
  color: string;
  length?: number; // New prop for note length
  onEditLength?: (newLength: number) => void; // Callback for drag adjustments
  'aria-label'?: string;
}

export const StepButton: React.FC<StepButtonProps> = ({
    isActive, isCurrent, onClick, color, length = 1, onEditLength, 'aria-label': ariaLabel
}) => {
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Styling logic
  const baseColor = 'bg-gray-800';
  let activeColor = 'bg-gray-600';
  let borderColor = 'border-gray-700';

  if (color === 'cyan') { activeColor = 'bg-cyan-500 shadow-[0_0_10px_rgba(6,182,212,0.6)]'; borderColor = 'border-cyan-400'; }
  if (color === 'pink') { activeColor = 'bg-pink-500 shadow-[0_0_10px_rgba(236,72,153,0.6)]'; borderColor = 'border-pink-400'; }
  if (color === 'yellow') { activeColor = 'bg-yellow-500 shadow-[0_0_10px_rgba(234,179,8,0.6)]'; borderColor = 'border-yellow-400'; }
  if (color === 'purple') { activeColor = 'bg-purple-500 shadow-[0_0_10px_rgba(168,85,247,0.6)]'; borderColor = 'border-purple-400'; }

  const handlePointerDown = (e: React.PointerEvent) => {
    // 1. Shift + Click/Drag -> Adjust Length
    if (e.shiftKey && onEditLength && isActive) {
      e.preventDefault();
      e.stopPropagation();

      const target = e.currentTarget as HTMLButtonElement;
      target.setPointerCapture(e.pointerId);

      const startX = e.clientX;
      const startLength = length;
      const sensitivity = 15; // Pixels per step (lower = faster)

      const handlePointerMove = (ev: PointerEvent) => {
        const delta = ev.clientX - startX;
        const stepsToAdd = Math.floor(delta / sensitivity);
        // Clamp length between 1 and 16
        const newLength = Math.max(1, Math.min(16, startLength + stepsToAdd));

        if (newLength !== length) {
          onEditLength(newLength);
        }
      };

      const handlePointerUp = (ev: PointerEvent) => {
        target.removeEventListener('pointermove', handlePointerMove as unknown as EventListener);
        target.removeEventListener('pointerup', handlePointerUp as unknown as EventListener);
        target.releasePointerCapture(ev.pointerId);
      };

      target.addEventListener('pointermove', handlePointerMove as unknown as EventListener);
      target.addEventListener('pointerup', handlePointerUp as unknown as EventListener);
    }
    // 2. Normal Click -> Toggle
    else if (!e.shiftKey) {
        onClick();
    }
  };

  return (
    <button
      ref={buttonRef}
      aria-label={ariaLabel}
      className={`
        w-full h-8 rounded-sm border transition-all duration-75 relative
        ${isActive ? activeColor : baseColor}
        ${isCurrent ? 'brightness-150 border-white' : borderColor}
        ${isCurrent && !isActive ? 'bg-gray-700' : ''}
        select-none touch-none
      `}
      onPointerDown={handlePointerDown}
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* Visual Indicator for Tied Notes */}
      {isActive && length > 1 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
             <div className="bg-black/40 text-white text-[9px] font-bold px-1 rounded backdrop-blur-sm">
                 {length}x
             </div>
             {/* Simple arrow or bar to indicate extension */}
             <div className="absolute right-0 top-1/2 -translate-y-1/2 w-1 h-1 bg-white/50 rounded-full translate-x-1/2" />
        </div>
      )}
    </button>
  );
};
