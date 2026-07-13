import React from 'react';
import type { ImportReport } from '../../importers/rbs';

interface ImportReportPanelProps {
  importReport: ImportReport;
  importedSongName: string;
}

// ⚡ Bolt: Added React.memo to prevent unnecessary re-renders when parent state changes.
export const ImportReportPanel: React.FC<ImportReportPanelProps> = React.memo(({ importReport, importedSongName }) => {
  return (
    <div className="p-4 bg-emerald-950/30 border border-emerald-700/50 rounded-lg" aria-live="polite" data-testid="rbs-import-report">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-emerald-400 text-lg">✓</span>
        <h3 className="text-sm font-semibold text-emerald-300">
          Loaded: {importedSongName}
        </h3>
      </div>
      <div className="grid grid-cols-3 gap-3 text-xs mb-3">
        <div className="p-2 bg-emerald-900/20 rounded text-center">
          <span className="block text-gray-400">Steps</span>
          <span className="text-white font-medium">{importReport.stepsConverted}</span>
        </div>
        <div className="p-2 bg-emerald-900/20 rounded text-center">
          <span className="block text-gray-400">Slides</span>
          <span className="text-white font-medium">{importReport.slideCount}</span>
        </div>
        <div className="p-2 bg-emerald-900/20 rounded text-center">
          <span className="block text-gray-400">Accents</span>
          <span className="text-white font-medium">{importReport.accentCount}</span>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 text-xs mb-3">
        {importReport.pcfEnabled && (
          <span className="px-2 py-0.5 bg-purple-500/20 text-purple-300 rounded border border-purple-500/30">PCF</span>
        )}
        {importReport.automationLanesConverted > 0 && (
          <span
            className="px-2 py-0.5 bg-blue-500/20 text-blue-300 rounded border border-blue-500/30"
            data-testid="rbs-automation-lane-count"
            data-lane-count={importReport.automationLanesConverted}
          >
            {importReport.automationLanesConverted} automation lane{importReport.automationLanesConverted !== 1 ? 's' : ''}
          </span>
        )}
        {importReport.songMode?.isSongMode && (
          <span
            className="px-2 py-0.5 bg-green-500/20 text-green-300 rounded border border-green-500/30"
            data-testid="rbs-song-mode-badge"
          >
            Song mode: {importReport.songMode.patternBankCount} patterns, {importReport.songMode.songLengthBars} bars, {importReport.songMode.arrangementEventCount} events
          </span>
        )}
        <span className="px-2 py-0.5 bg-amber-500/20 text-amber-300 rounded border border-amber-500/30">
          Open303 wired
        </span>
      </div>
      {importReport.warnings.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-yellow-400/80 hover:text-yellow-300 mb-1">
            {importReport.warnings.length} warning{importReport.warnings.length !== 1 ? 's' : ''}
          </summary>
          <ul className="pl-3 space-y-0.5 text-gray-400 list-disc list-inside">
            {importReport.warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </details>
      )}
    </div>
  );
});
