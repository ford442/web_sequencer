import React from 'react';

interface MelodicLyricModeToggleProps {
  melodicMode: boolean;
  onMelodicModeChange?: (enabled: boolean) => void;
}

export const MelodicLyricModeToggle = React.memo(function MelodicLyricModeToggle({
  melodicMode,
  onMelodicModeChange,
}: MelodicLyricModeToggleProps) {
  return (
    <div className="bg-gradient-to-r from-purple-900/30 to-indigo-900/30 border border-purple-500/30 p-2 rounded">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-purple-400" viewBox="0 0 20 20" fill="currentColor">
            <path d="M18 3a1 1 0 00-1.447-.894L8.763 6H5a3 3 0 000 6h.28l1.771 5.316A1 1 0 008 18h1a1 1 0 001-1v-4.382l6.553 3.276A1 1 0 0018 15V3z" />
          </svg>
          <div>
            <label className="text-[10px] text-purple-300 font-bold block">MELODIC LYRIC MODE</label>
            <span className="text-[9px] text-gray-500">Drag steps to set pitch</span>
          </div>
        </div>
        <button type="button"
          onClick={() => onMelodicModeChange?.(!melodicMode)}
          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-400 ${
            melodicMode ? 'bg-purple-600' : 'bg-gray-700'
          }`}
          aria-label="Melodic Mode"
          role="switch"
          aria-checked={melodicMode}
        >
          <span
            className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
              melodicMode ? 'translate-x-5' : 'translate-x-1'
            }`}
          />
        </button>
      </div>
      {melodicMode && (
        <div className="mt-2 pt-2 border-t border-purple-500/20">
          <div className="flex items-center gap-2 text-[9px] text-gray-400">
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-red-500"></span> C
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-orange-500"></span> D
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-yellow-500"></span> E
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-green-500"></span> F
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-cyan-500"></span> G
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-blue-500"></span> A
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-purple-500"></span> B
            </span>
          </div>
        </div>
      )}
    </div>
  );
});
