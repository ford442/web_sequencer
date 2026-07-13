import React from 'react';
import type { AISongData } from '../../importers/ai-song';
import type { TrackStats } from '../../types/aiSongModal';
import { PreviewSkeleton } from '../ai-song/PreviewSkeleton';
import { SongInfoPanel } from './SongInfoPanel';
import { PatternGridPanel } from './PatternGridPanel';
import { TrackStatisticsPanel } from './TrackStatisticsPanel';
import { AutomationVisualizationPanel } from './AutomationVisualizationPanel';
import { Tooltip } from './Tooltip';

interface PreviewTabPanelProps {
  isPreviewLoading: boolean;
  parsedData: AISongData | null;
  trackStats: TrackStats | null;
  patternGrid: { tracks: string[]; grid: boolean[][] } | null;
  trackStatisticsRows: React.ReactElement[];
  parsedAutomationRows: React.ReactNode[] | null;
  audioEngine?: unknown;
  onShowToast: (message: string, type?: 'success' | 'error' | 'info') => void;
}

export const PreviewTabPanel = React.memo(function PreviewTabPanel({
  isPreviewLoading,
  parsedData,
  trackStats,
  patternGrid,
  trackStatisticsRows,
  parsedAutomationRows,
  audioEngine,
  onShowToast,
}: PreviewTabPanelProps) {
  return (
    <div id="ai-modal-panel-preview" role="tabpanel" aria-labelledby="ai-modal-tab-preview" className="space-y-4">
      {isPreviewLoading ? (
        <PreviewSkeleton />
      ) : parsedData && trackStats && patternGrid ? (
        <div className="animate-in fade-in duration-300">
          <SongInfoPanel parsedData={parsedData} trackStats={trackStats} />
          <PatternGridPanel patternGrid={patternGrid} />
          <TrackStatisticsPanel trackStats={trackStats} trackStatisticsRows={trackStatisticsRows} />
          <AutomationVisualizationPanel
            trackStats={trackStats}
            parsedData={parsedData}
            parsedAutomationRows={parsedAutomationRows}
          />

          {audioEngine != null && (
            <div className="p-4 bg-gray-900/50 rounded-lg">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <h3 className="text-sm font-medium text-gray-300">Audio Preview</h3>
                  <p className="text-xs text-gray-500">Listen to the pattern before importing</p>
                </div>
                <Tooltip text="Coming soon!" position="left">
                  <button type="button"
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium rounded transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0f1115]"
                    onClick={() => onShowToast('Audio preview coming soon!', 'info')}
                    disabled
                    aria-label="Play Preview (Coming Soon)"
                  >
                    <span>▶</span> Play Preview
                  </button>
                </Tooltip>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="w-16 h-16 rounded-full bg-gray-800 flex items-center justify-center mb-4">
            <span className="text-3xl">👁️</span>
          </div>
          <h3 className="text-sm font-medium text-gray-400 mb-2">No Preview Available</h3>
          <p className="text-xs text-gray-600 max-w-xs">
            Paste or drop valid JSON in the Paste tab to see a preview of your song.
          </p>
        </div>
      )}
    </div>
  );
});
