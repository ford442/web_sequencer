import React, { memo } from 'react'
import { ROWS } from './MainSequencer'
import type { TrackKey } from '../constants/appDefaults'

interface RackProps {
    is3DMode: boolean;
    selectedTrack: TrackKey;
    onSelectTrack: (track: TrackKey) => void;
    modules: Record<TrackKey, React.ReactNode>;
}

export const Rack = memo(({ is3DMode, selectedTrack, onSelectTrack, modules }: RackProps) => {
    return (
        <div className="w-full h-full hyphon-rack-shell relative flex flex-col">
            <div className="absolute inset-0 rounded-2xl border-2 border-cyan-900/10 pointer-events-none z-[1]" aria-hidden="true" />
            {is3DMode && (
                <div className="flex items-center justify-center gap-2 p-2 bg-[#050709] border-b border-gray-800 shrink-0 z-50 relative pointer-events-auto">
                    {ROWS.map((row: any) => (
                        <button type="button"
                            key={row.key}
                            onClick={() => onSelectTrack(row.key as TrackKey)}
                            aria-label={`Select ${row.label} track`}
                            className={`px-4 py-2 rounded text-xs font-bold font-orbitron border transition-all hyphon-btn ${selectedTrack === row.key ? 'hyphon-btn--accent-active' : 'hyphon-btn--ghost'}`}
                        >
                            {row.label.toUpperCase()}
                        </button>
                    ))}
                </div>
            )}
            <div className="flex-1 relative overflow-hidden">
                {modules[selectedTrack]}
            </div>
        </div>
    );
}, (prev, next) => {
    if (prev.is3DMode !== next.is3DMode) return false;
    if (prev.selectedTrack !== next.selectedTrack) return false;
    if (prev.onSelectTrack !== next.onSelectTrack) return false;
    return prev.modules[prev.selectedTrack] === next.modules[next.selectedTrack];
});
