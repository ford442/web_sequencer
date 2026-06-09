import React from 'react';

export interface PropertyToggleProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  ariaLabel?: string;
  accentColor?: string;
}

export const PropertyToggle: React.FC<PropertyToggleProps> = ({
  label,
  checked,
  onChange,
  ariaLabel,
  accentColor = "bg-cyan-500"
}) => {
  return (
    <div className="flex items-center justify-between group">
      <span className="text-xs font-bold font-orbitron text-cyan-400 group-hover:text-cyan-300 transition-colors drop-shadow-[0_0_5px_rgba(6,182,212,0.3)]">
        {label}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={ariaLabel || label}
        onClick={(e) => {
          e.stopPropagation();
          onChange(!checked);
        }}
        className={`relative inline-flex h-4 w-8 items-center rounded-full transition-colors ${checked ? accentColor : 'bg-gray-700'}`}
      >
        <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${checked ? 'translate-x-4' : 'translate-x-1'}`} />
      </button>
    </div>
  );
};
