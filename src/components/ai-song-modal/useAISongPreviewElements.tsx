import { useMemo } from 'react';
import type { AISongData } from '../../importers/ai-song';
import type { TrackStats } from '../../types/aiSongModal';

export function useAISongPreviewElements(parsedData: AISongData | null, trackStats: TrackStats | null) {
  const noteCountEntries = useMemo(() => {
    return trackStats ? Object.entries(trackStats.noteCounts) : [];
  }, [trackStats]);

  const trackStatisticsRows = useMemo(() => noteCountEntries.map(([track, count]) => (
    <div key={String(track)} className="flex items-center gap-2 text-xs">
      <span className="w-16 sm:w-20 text-gray-500 shrink-0">{String(track)}:</span>
      <div className="flex-1 h-2 bg-gray-800 rounded-full overflow-hidden">
        <div
          className="h-full bg-emerald-500/50 rounded-full transition-all duration-500"
          style={{ width: `${Math.min(100, (Number(count) / 16) * 100)}%` }}
        />
      </div>
      <span className="text-gray-400 w-6 sm:w-8 text-right shrink-0">{String(count)}</span>
    </div>
  )) as React.ReactElement[], [noteCountEntries]);

  const parsedTracksElements = useMemo(() => {
    if (!parsedData?.tracks) return null;
    return Object.keys(parsedData.tracks).map(track => (
      <span key={track} className="px-1.5 py-0.5 bg-emerald-500/10 rounded text-emerald-400/70 text-[10px]">
        {track}
      </span>
    ));
  }, [parsedData?.tracks]);

  const parsedAutomationLanesList = useMemo(() => {
    if (!parsedData?.automation) return null;
    return parsedData.automation.map((lane, idx) => (
      <span key={idx} className="text-[10px] text-cyan-400/50">
        {String(lane.target)}.{String(lane.parameter)}
        {idx < parsedData.automation!.length - 1 ? ',' : ''}
      </span>
    ));
  }, [parsedData?.automation]);

  const parsedAutomationRows = useMemo(() => {
    if (!parsedData?.automation) return null;
    return parsedData.automation.map((lane, idx) => {
      // ⚡ Bolt Optimization: Removed .map()/.filter() and replaced Math.max(...array) with a single pass O(n) loop.
      // This prevents "Maximum call stack size exceeded" errors on large datasets and eliminates intermediate array GC allocations.
      let minVal = Infinity;
      let maxVal = -Infinity;
      let validPointCount = 0;
      for (let i = 0; i < lane.steps.length; i++) {
        const val = lane.steps[i];
        if (val !== null) {
          validPointCount++;
          if (val < minVal) minVal = val;
          if (val > maxVal) maxVal = val;
        }
      }
      if (minVal === Infinity) minVal = 0;
      if (maxVal === -Infinity) maxVal = 0;

      return (
        <div key={idx} className="bg-gray-800/50 rounded p-2">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-cyan-400">{lane.target}</span>
              <span className="text-xs text-gray-500">→</span>
              <span className="text-xs text-cyan-400/80">{lane.parameter}</span>
            </div>
            <div className="flex items-center gap-2 text-[10px] text-gray-500">
              <span className="px-1.5 py-0.5 bg-gray-700 rounded">{String(lane.interpolation || 'step')}</span>
              <span>{String(validPointCount)} pts</span>
              <span className="text-gray-600">|</span>
              <span>range: {String(minVal)}-{String(maxVal)}</span>
            </div>
          </div>
          <div className="flex items-end gap-px h-8">
            {lane.steps.map((value, stepIdx) => {
              const height = value !== null ? (value / 127) * 100 : 0;
              const isActive = value !== null;
              return (
                <div
                  key={stepIdx}
                  className={`flex-1 min-w-[2px] transition-all ${
                    isActive
                      ? 'bg-cyan-500/60 hover:bg-cyan-400'
                      : 'bg-gray-700/30'
                  }`}
                  style={{
                    height: isActive ? `${height}%` : '2px',
                    opacity: stepIdx % 4 === 0 ? 1 : 0.7,
                  }}
                  title={isActive ? `Step ${stepIdx}: ${value}` : `Step ${stepIdx}: (no change)`}
                />
              );
            })}
          </div>
          <div className="flex mt-1">
            {[0, 4, 8, 12, 16, 20, 24, 28].map(mark => (
              <div key={mark} className="flex-1 text-[8px] text-gray-600 text-center">
                {mark}
              </div>
            ))}
          </div>
        </div>
      );
    });
  }, [parsedData?.automation]);

  return {
    trackStatisticsRows,
    parsedTracksElements,
    parsedAutomationLanesList,
    parsedAutomationRows,
  };
}
