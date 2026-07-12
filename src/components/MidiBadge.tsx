import React, { memo } from 'react';

interface MidiBadgeProps {
  /** Show mapped indicator */
  mapped?: boolean;
  /** Brief activity flash when CC received */
  active?: boolean;
  className?: string;
}

/** Small MIDI indicator for mapped controls. */
export const MidiBadge = memo(function MidiBadge({ mapped, active, className = '' }: MidiBadgeProps) {
  if (!mapped && !active) return null;
  return (
    <span
      className={`text-[7px] font-bold uppercase tracking-widest px-1 py-0.5 rounded border ${
        active
          ? 'bg-purple-500 text-white border-purple-300 animate-pulse shadow-[0_0_8px_rgba(168,85,247,0.8)]'
          : 'bg-purple-950/90 text-purple-300 border-purple-500/50'
      } ${className}`}
      title={active ? 'Receiving MIDI' : 'MIDI mapped'}
      aria-label={active ? 'MIDI activity' : 'MIDI mapped'}
    >
      MIDI
    </span>
  );
});
