import React from 'react';

interface StepButtonProps {
  isActive: boolean;
  isCurrent: boolean;
  isSelected?: boolean;
  onClick: (e: React.MouseEvent) => void;
  onMouseDown?: (e: React.MouseEvent) => void;
  onMouseEnter?: (e: React.MouseEvent) => void;
  color: 'cyan' | 'pink' | 'yellow' | 'purple' | 'red' | 'green' | string;
  'aria-label': string;
}

export const StepButton: React.FC<StepButtonProps> = ({
  isActive,
  isCurrent,
  isSelected,
  onClick,
  onMouseDown,
  onMouseEnter,
  color,
  'aria-label': ariaLabel
}) => {
  const getColorClasses = (c: string) => {
      switch (c) {
          case 'cyan': return { active: 'bg-cyan-500 shadow-[0_0_8px_2px_rgba(6,182,212,0.7)]', current: 'ring-cyan-300' };
          case 'pink': return { active: 'bg-pink-500 shadow-[0_0_8px_2px_rgba(236,72,153,0.7)]', current: 'ring-pink-300' };
          case 'yellow': return { active: 'bg-yellow-500 shadow-[0_0_8px_2px_rgba(234,179,8,0.7)]', current: 'ring-yellow-300' };
          case 'purple': return { active: 'bg-purple-500 shadow-[0_0_8px_2px_rgba(168,85,247,0.7)]', current: 'ring-purple-300' };
          case 'red': return { active: 'bg-red-500 shadow-[0_0_8px_2px_rgba(239,68,68,0.7)]', current: 'ring-red-300' };
          case 'green': return { active: 'bg-green-500 shadow-[0_0_8px_2px_rgba(34,197,94,0.7)]', current: 'ring-green-300' };
          default: return { active: 'bg-cyan-500 shadow-[0_0_8px_2px_rgba(6,182,212,0.7)]', current: 'ring-cyan-300' };
      }
  };

  const classes = getColorClasses(color);
  // UPDATED: Removed 'aspect-square', added 'h-10' (or h-9/h-8 depending on preference) to allow width stretching
  const baseClasses = 'w-full h-10 rounded-md transition-all duration-100 ease-in-out transform focus:outline-none';
  const inactiveClasses = 'bg-gray-700 hover:bg-gray-600';
  const activeClasses = classes.active;
  const currentClasses = `ring-2 ring-offset-2 ring-offset-gray-800 ${classes.current}`;
  // Use a solid white ring for selection to stand out against colored rings
  const selectedClasses = 'ring-2 ring-white z-10';

  const handleClick = (e: React.MouseEvent) => {
    onClick(e);
  };

  return (
    <button
      onClick={handleClick}
      onMouseDown={onMouseDown}
      onMouseEnter={onMouseEnter}
      aria-pressed={isActive}
      aria-label={ariaLabel}
      aria-selected={isSelected}
      className={`${baseClasses} ${isActive ? activeClasses : inactiveClasses} ${isCurrent ? currentClasses : ''} ${isSelected ? selectedClasses : ''}`}
    />
  );
};
