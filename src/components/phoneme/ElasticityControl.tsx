import React from 'react';
import { ELASTICITY_MAX, ELASTICITY_MIN, clampElasticity } from '@/engines/rubberband/phonemeElasticity';

export interface ElasticityControlProps {
  phonemeId: string;
  elasticity: number | undefined;
  onChange: (id: string, elasticity: number) => void;
}

/** Selected-phoneme elasticity slider (50–150 %): the keyboard path for the pill handle. */
export const ElasticityControl: React.FC<ElasticityControlProps> = ({ phonemeId, elasticity, onChange }) => {
  const percent = Math.round(clampElasticity(elasticity) * 100);
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-zinc-400 font-mono">Elasticity</span>
      <input
        type="range"
        min={ELASTICITY_MIN * 100}
        max={ELASTICITY_MAX * 100}
        step={1}
        value={percent}
        onChange={(e) => onChange(phonemeId, parseInt(e.target.value, 10) / 100)}
        className="w-24 h-1 bg-zinc-700 rounded-lg appearance-none focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 focus-visible:ring-cyan-500"
        aria-label="Elasticity"
        aria-valuetext={`${percent}% of its aligned share of the note`}
      />
      <span className={`text-[10px] font-mono w-10 ${percent === 100 ? 'text-zinc-600' : percent > 100 ? 'text-amber-300' : 'text-sky-300'}`}>
        {percent}%
      </span>
    </div>
  );
};
