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
        <div className="flex flex-col items-center justify-center py-12 px-4 text-center bg-gray-800/20 border border-dashed border-gray-700 rounded-lg">
          <div className="w-12 h-12 rounded-full bg-cyan-900/30 flex items-center justify-center mb-4 text-cyan-500">
            <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
          </div>
          <h3 className="text-gray-300 font-bold mb-2 text-sm">No Preview Available</h3>
          <p className="text-gray-500 text-xs max-w-[250px]">
            Paste or drop valid JSON in the Paste tab to see a preview of your song.
          </p>
        </div>
      )}
    </div>
  );
});
