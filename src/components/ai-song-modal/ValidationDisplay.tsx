import React from 'react';
import type { AISongData } from '../../importers/ai-song';
import type { ValidationState } from '../../types/aiSongModal';
import { getErrorSuggestions } from '../../utils/aiSongUtils';
import { Tooltip } from './Tooltip';

interface ValidationDisplayProps {
  validationState: ValidationState;
  hasErrors: boolean;
  isValid: boolean;
  parsedData: AISongData | null;
  showFixSuccess: boolean;
  copiedError: boolean;
  onFixCommonIssues: () => void;
  onCopyErrorReport: () => void;
  parsedTracksElements: React.ReactNode;
  parsedAutomationLanesList: React.ReactNode;
}

export const ValidationProgress = React.memo(function ValidationProgress({
  validationState,
}: { validationState: ValidationState }) {
  if (validationState.stage === 'idle' || validationState.stage === 'error' || validationState.stage === 'complete') {
    return null;
  }

  return (
    <div className="flex items-center gap-2 text-xs text-yellow-400">
      <span className="animate-spin">⏳</span>
      <span>
        {validationState.stage === 'parsing' && 'Checking JSON syntax...'}
        {validationState.stage === 'validating' && 'Validating schema...'}
        {validationState.stage === 'converting' && 'Converting to Hyphon format...'}
      </span>
    </div>
  );
});

export const ValidationErrorDisplay = React.memo(function ValidationErrorDisplay({
  validationState,
  showFixSuccess,
  copiedError,
  onFixCommonIssues,
  onCopyErrorReport,
}: Pick<ValidationDisplayProps, 'validationState' | 'showFixSuccess' | 'copiedError' | 'onFixCommonIssues' | 'onCopyErrorReport'>) {
  return (
    <div className="p-4 bg-red-950/30 border border-red-900/50 rounded-lg animate-in fade-in slide-in-from-top-2">
      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
        <div className="flex items-center gap-2 text-red-400">
          <span>⚠️</span>
          <span className="text-sm font-medium">
            {validationState.category === 'JSON_SYNTAX' && 'JSON Syntax Error'}
            {validationState.category === 'SCHEMA_VIOLATION' && 'Schema Violation'}
            {validationState.category === 'CONVERSION_ERROR' && 'Conversion Error'}
            {validationState.category === 'NETWORK_ERROR' && 'Network Error'}
          </span>
        </div>
        <div className="flex gap-2">
          {validationState.category === 'JSON_SYNTAX' && (
            <Tooltip text="Auto-fix common JSON issues" position="left">
              <button type="button"
                onClick={onFixCommonIssues}
                className="px-3 py-1 bg-red-900/50 hover:bg-red-800/50 text-red-300 text-xs rounded transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0f1115]"
                aria-label="Fix Common JSON Issues"
              >
                🔧 Fix Issues
              </button>
            </Tooltip>
          )}
          <Tooltip text="Copy error details to clipboard" position="left">
            <button type="button"
              onClick={onCopyErrorReport}
              className="px-3 py-1 bg-gray-800 hover:bg-gray-700 text-gray-400 text-xs rounded transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0f1115]"
              aria-label="Copy error details to clipboard"
            >
              {copiedError ? '✓ Copied!' : '📋 Copy'}
            </button>
          </Tooltip>
        </div>
      </div>

      {showFixSuccess && (
        <div className="mb-3 p-2 bg-emerald-900/30 border border-emerald-700/50 rounded text-emerald-400 text-xs animate-in fade-in">
          ✓ Common issues fixed! Please review the changes.
        </div>
      )}

      <div className="space-y-2 mt-3">
        {validationState.fieldErrors.map((error, idx) => (
          <div key={idx} className="text-xs p-2 bg-red-900/20 rounded border border-red-800/30">
            <div className="flex items-start gap-2">
              <span className="text-red-500 mt-0.5">●</span>
              <div>
                <div className="text-red-400 font-mono font-medium">{error.field}</div>
                <div className="text-red-300/80">{error.message}</div>
                {error.suggestion && (
                  <div className="text-gray-500 mt-1 flex items-center gap-1">
                    <span>💡</span>
                    <span>{error.suggestion}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {validationState.category && (
        <div className="mt-3 pt-3 border-t border-red-900/30">
          <p className="text-xs text-gray-500 mb-1">Suggestions:</p>
          <ul className="text-xs text-gray-400 space-y-0.5 list-disc list-inside">
            {getErrorSuggestions(validationState.category).map((suggestion, idx) => (
              <li key={idx}>{suggestion}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
});

export const ValidationSuccessDisplay = React.memo(function ValidationSuccessDisplay({
  parsedData,
  parsedTracksElements,
  parsedAutomationLanesList,
}: Pick<ValidationDisplayProps, 'parsedData' | 'parsedTracksElements' | 'parsedAutomationLanesList'>) {
  if (!parsedData) return null;

  return (
    <div className="p-4 bg-emerald-950/30 border border-emerald-900/50 rounded-lg animate-in fade-in slide-in-from-top-2">
      <div className="flex items-center gap-2 text-emerald-400 mb-3">
        <span className="w-5 h-5 rounded-full bg-emerald-500/20 flex items-center justify-center text-xs">✓</span>
        <span className="text-sm font-medium">Valid AI Song</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
        <p className="flex justify-between sm:block">
          <span className="text-gray-500">Title:</span>
          <span className="text-emerald-400/70 sm:ml-1">{String(parsedData.meta.title)}</span>
        </p>
        <p className="flex justify-between sm:block">
          <span className="text-gray-500">Author:</span>
          <span className="text-emerald-400/70 sm:ml-1">{String(parsedData.meta.author)}</span>
        </p>
        <p className="flex justify-between sm:block">
          <span className="text-gray-500">Tempo:</span>
          <span className="text-emerald-400/70 sm:ml-1">{String(parsedData.globals.tempo)} BPM</span>
        </p>
        <p className="flex justify-between sm:block">
          <span className="text-gray-500">Generator:</span>
          <span className="text-emerald-400/70 sm:ml-1">{String(parsedData.meta.generator)}</span>
        </p>
        <p className="sm:col-span-2 flex flex-wrap gap-1">
          <span className="text-gray-500">Tracks:</span>
          {parsedTracksElements}
        </p>
        {parsedData.automation && parsedData.automation.length > 0 && (
          <p className="sm:col-span-2 flex flex-wrap gap-1 items-center">
            <span className="text-gray-500">Automation:</span>
            <span className="px-1.5 py-0.5 bg-cyan-500/10 rounded text-cyan-400/70 text-[10px]">
              {String(parsedData.automation.length)} lane{parsedData.automation.length !== 1 ? 's' : ''}
            </span>
            {parsedAutomationLanesList}
          </p>
        )}
      </div>
    </div>
  );
});
