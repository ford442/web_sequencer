import React, { useCallback } from 'react';

export interface PropertySliderProps {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  accentColor?: string;
  borderColor?: string;
  valueFormatter?: (value: number) => string | number;
  onChange: (value: number) => void;
  ariaLabel?: string;
  id?: string;
}

export const PropertySlider: React.FC<PropertySliderProps> = ({
  label,
  value,
  min = 0,
  max = 1,
  step = 0.01,
  accentColor = "accent-cyan-400 hover:accent-cyan-300",
  borderColor = "border-cyan-900/30",
  valueFormatter = (val) => val,
  onChange,
  ariaLabel,
  id
}) => {
  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(parseFloat(e.target.value));
  }, [onChange]);

  return (
    <fieldset className="flex flex-col gap-1 border-none p-0 m-0">
      <legend className="sr-only">{label}</legend>
      <div className="flex justify-between text-[10px] text-cyan-200/70 font-bold uppercase" aria-hidden="true">
        <label htmlFor={id || label}>{label}</label>
        <span className="text-cyan-400 font-mono text-[10px] drop-shadow-[0_0_5px_rgba(34,211,238,0.5)]">
          {valueFormatter(value)}
        </span>
      </div>
      <input
        id={id || label}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={handleChange}
        className={`w-full h-2 bg-gray-800 rounded-lg appearance-none cursor-pointer ${accentColor} border ${borderColor} transition-all`}
        aria-valuetext={String(valueFormatter(value))}
        aria-label={ariaLabel || label}
      />
    </fieldset>
  );
};
