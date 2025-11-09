
import React from 'react';

interface StepButtonProps {
  isActive: boolean;
  isCurrent: boolean;
  onClick: () => void;
  color: 'cyan' | 'pink' | 'yellow';
  'aria-label': string;
}

export const StepButton: React.FC<StepButtonProps> = ({ isActive, isCurrent, onClick, color, 'aria-label': ariaLabel }) => {
  const colorClasses = {
    cyan: {
      active: 'bg-cyan-500 shadow-[0_0_8px_2px_rgba(6,182,212,0.7)]',
      current: 'ring-cyan-300',
    },
    pink: {
      active: 'bg-pink-500 shadow-[0_0_8px_2px_rgba(236,72,153,0.7)]',
      current: 'ring-pink-300',
    },
    yellow: {
      active: 'bg-yellow-500 shadow-[0_0_8px_2px_rgba(234,179,8,0.7)]',
      current: 'ring-yellow-300',
    }
  };

  const baseClasses = 'w-full aspect-square rounded-md transition-all duration-100 ease-in-out transform focus:outline-none';
  const inactiveClasses = 'bg-gray-700 hover:bg-gray-600';
  const activeClasses = colorClasses[color].active;
  const currentClasses = `ring-2 ring-offset-2 ring-offset-gray-800 ${colorClasses[color].current}`;

  return (
    <button
      onClick={onClick}
      aria-pressed={isActive}
      aria-label={ariaLabel}
      className={`${baseClasses} ${isActive ? activeClasses : inactiveClasses} ${isCurrent ? currentClasses : ''}`}
    />
  );
};
