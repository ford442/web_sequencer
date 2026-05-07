import React, { memo } from 'react';
import { NOTES, SCALE_NAMES, TUNING_SYSTEMS } from '../utils/musicTheory';
import type { ScaleDefinition, TuningSystem } from '../utils/musicTheory';

interface ScaleSelectorProps {
    /** Current scale definition, or null if no scale lock is active */
    currentScale: ScaleDefinition | null;
    /** Callback when the user changes the scale (null = off) */
    onChange: (scale: ScaleDefinition | null) => void;
}

export const ScaleSelector: React.FC<ScaleSelectorProps> = memo(({ currentScale, onChange }) => {
    const isActive = currentScale !== null;

    const handleToggle = () => {
        if (isActive) {
            onChange(null);
        } else {
            onChange({ root: 'C', scale: 'Minor', tuningSystem: '12-TET' });
        }
    };

    const handleTuningChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        if (!currentScale) return;
        onChange({ ...currentScale, tuningSystem: e.target.value as TuningSystem });
    };

    const handleRootChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        if (!currentScale) return;
        onChange({ ...currentScale, root: e.target.value });
    };

    const handleScaleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        if (!currentScale) return;
        onChange({ ...currentScale, scale: e.target.value });
    };

    return (
        <div className="flex items-center gap-1.5 bg-gray-900/80 border border-gray-700 rounded-lg px-2 py-1">
            <button
                onClick={handleToggle}
                className={`px-2 py-0.5 text-[10px] font-bold font-orbitron rounded transition-all ${
                    isActive
                        ? 'bg-amber-500 text-black hover:bg-amber-400'
                        : 'bg-gray-700 text-gray-400 hover:bg-gray-600 hover:text-gray-200'
                }`}
                aria-pressed={isActive}
                aria-label="Key Lock"
                title="Enable Scale Lock — constrain notes to a musical key"
            >
                🔑 KEY
            </button>

            {isActive && (
                <>
                    <select
                        value={currentScale!.root}
                        onChange={handleRootChange}
                        className="bg-gray-800 text-cyan-400 text-[10px] font-mono border border-gray-600 rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-cyan-400"
                        aria-label="Root note"
                    >
                        {NOTES.map(note => (
                            <option key={note} value={note}>{note}</option>
                        ))}
                    </select>

                    <select
                        value={currentScale!.scale}
                        onChange={handleScaleChange}
                        className="bg-gray-800 text-cyan-400 text-[10px] font-mono border border-gray-600 rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-cyan-400"
                        aria-label="Scale type"
                    >
                        {SCALE_NAMES.map(name => (
                            <option key={name} value={name}>{name}</option>
                        ))}
                    </select>

                    <select
                        value={currentScale!.tuningSystem || '12-TET'}
                        onChange={handleTuningChange}
                        className="bg-gray-800 text-cyan-400 text-[10px] font-mono border border-gray-600 rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-cyan-400"
                        aria-label="Tuning System"
                    >
                        {TUNING_SYSTEMS.map(tuning => (
                            <option key={tuning} value={tuning}>{tuning}</option>
                        ))}
                    </select>
                </>
            )}
        </div>
    );
});
