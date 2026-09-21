import React from 'react';
import type { AISongData } from '../../importers/ai-song';
import type { TrackStats } from '../../types/aiSongModal';
import { PreviewSkeleton } from '../ai-song/PreviewSkeleton';
import { SongInfoPanel } from './SongInfoPanel';
import { PatternGridPanel } from './PatternGridPanel';
import { TrackStatisticsPanel } from './TrackStatisticsPanel';
import { AutomationVisualizationPanel } from './AutomationVisualizationPanel';
import { AudioPreviewPanel } from './AudioPreviewPanel';

interface PreviewTabPanelProps {
  isPreviewLoading: boolean;
  parsedData: AISongData | null;
  trackStats: TrackStats | null;
  patternGrid: { tracks: string[]; grid: boolean[][] } | null;
  trackStatisticsRows: React.ReactElement[];
  parsedAutomationRows: React.ReactNode[] | null;
  audioEngine?: unknown;
  onShowToast: (message: string, type?: 'success' | 'error' | 'info') => void;
  onSwitchToPaste?: () => void;
}

/**
 * Sample rate of the running engine, when the modal was given one.
 *
 * The preview must render at the rate the user is monitoring at; without a live
 * engine the sample-rate policy falls back on its own, so `null` is a valid
 * answer rather than a guess.
 */
function liveSampleRateOf(audioEngine: unknown): number | null {
  const context = (audioEngine as { context?: { sampleRate?: number } } | null | undefined)?.context;
  return typeof context?.sampleRate === 'number' ? context.sampleRate : null;
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
  onSwitchToPaste,
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

          <AudioPreviewPanel
            parsedData={parsedData}
            liveSampleRate={liveSampleRateOf(audioEngine)}
            onShowToast={onShowToast}
          />
        </div>
      ) : (
        <div role="status" className="flex flex-col items-center justify-center py-12 px-4 text-center bg-gray-800/20 border border-dashed border-gray-700 rounded-lg">
          <div className="w-12 h-12 rounded-full bg-cyan-900/30 flex items-center justify-center mb-4 text-cyan-500" aria-hidden="true">
            <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
          </div>
          <h3 className="text-gray-300 font-bold mb-2 text-sm">No Preview Available</h3>
          <p className="text-gray-500 text-xs mb-6 max-w-[250px]">
            Paste or drop valid JSON in the Paste tab to see a preview of your song.
          </p>
          {onSwitchToPaste && (
            <button type="button"
              onClick={onSwitchToPaste}
              className="bg-cyan-900/30 text-cyan-400 border border-cyan-800/50 hover:bg-cyan-900/50 px-4 py-2 rounded-full text-xs font-bold transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500"
            >
              Go to Paste Tab
            </button>
          )}
        </div>
      )}
    </div>
  );
});
