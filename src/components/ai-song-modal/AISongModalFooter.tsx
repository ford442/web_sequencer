import React from 'react';
import type { ImportStage, ValidationState } from '../../types/aiSongModal';
import type { AISongData } from '../../importers/ai-song';
import { LoadingButton } from '../LoadingButton';
import { Tooltip } from './Tooltip';

interface AISongModalFooterProps {
  validationState: ValidationState;
  jsonInput: string;
  parsedData: AISongData | null;
  isImporting: boolean;
  onClose: () => void;
  onImport: () => void;
}

export const AISongModalFooter = React.memo(function AISongModalFooter({
  validationState,
  jsonInput,
  parsedData,
  isImporting,
  onClose,
  onImport,
}: AISongModalFooterProps) {
  return (
    <div className="flex items-center justify-between p-3 sm:p-4 border-t border-gray-800">
      <div className="text-[10px] sm:text-xs text-gray-500 flex items-center gap-2">
        <span className={`
          w-2 h-2 rounded-full transition-colors duration-300
          ${validationState.stage === 'idle' ? 'bg-gray-600' : ''}
          ${(validationState.stage === 'parsing' || validationState.stage === 'validating') ? 'bg-yellow-500 animate-pulse' : ''}
          ${validationState.stage === 'converting' ? 'bg-emerald-500' : ''}
          ${validationState.stage === 'complete' ? 'bg-emerald-500' : ''}
          ${validationState.stage === 'error' ? 'bg-red-500' : ''}
        `} />
        <span className="hidden sm:inline">
          {validationState.stage === 'idle' && (jsonInput ? 'Waiting...' : 'Ready')}
          {validationState.stage === 'parsing' && 'Checking JSON syntax...'}
          {validationState.stage === 'validating' && 'Validating schema...'}
          {validationState.stage === 'converting' && 'Converting...'}
          {validationState.stage === 'complete' && '✓ Ready to import'}
          {validationState.stage === 'error' && `✗ ${validationState.fieldErrors.length} error(s)`}
        </span>
        <span className="sm:hidden">
          {validationState.stage === 'idle' && 'Ready'}
          {validationState.stage === 'parsing' && 'Parsing...'}
          {validationState.stage === 'validating' && 'Validating...'}
          {validationState.stage === 'converting' && 'Converting...'}
          {validationState.stage === 'complete' && '✓ Valid'}
          {validationState.stage === 'error' && '✗ Errors'}
        </span>
      </div>
      <div className="flex gap-2">
        <Tooltip text="Cancel (Esc)" position="top">
          <button type="button"
            onClick={onClose}
            disabled={isImporting}
            className="px-3 sm:px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs font-medium rounded transition-all disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0f1115]"
            aria-label="Cancel Import"
          >
            <span className="hidden sm:inline">Cancel</span>
            <span className="sm:hidden" aria-hidden="true">✕</span>
          </button>
        </Tooltip>
        <Tooltip text={parsedData ? 'Ctrl+Enter to import' : 'Enter valid JSON first'} position="top">
          <LoadingButton
            onClick={onImport}
            disabled={!parsedData}
            isLoading={isImporting}
            loadingText="Importing..."
            spinnerColor="text-white"
            className={`px-3 sm:px-4 py-2 text-xs font-medium rounded flex items-center justify-center gap-2 disabled:cursor-not-allowed ${
              parsedData && !isImporting
                ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-[0_0_20px_rgba(16,185,129,0.3)] hover:shadow-[0_0_30px_rgba(16,185,129,0.5)]'
                : 'bg-gray-700 text-gray-500'
            }`}
            aria-label="Import AI Song"
          >
            <>
              <span aria-hidden="true">🎵</span>
              <span className="hidden sm:inline">Import Song</span>
              <span className="sm:hidden">Import</span>
            </>
          </LoadingButton>
        </Tooltip>
      </div>
    </div>
  );
});

interface ImportProgressBarProps {
  importStages: ImportStage[];
}

export const ImportProgressBar = React.memo(function ImportProgressBar({
  importStages,
}: ImportProgressBarProps) {
  return (
    <div className="px-4 py-3 border-t border-gray-800 bg-gray-900/30 animate-in slide-in-from-bottom-2">
      <div className="space-y-2">
        {importStages.map((stage) => (
          <div key={stage.name} className="flex items-center gap-3">
            <div className="w-14 sm:w-16 text-[10px] sm:text-xs text-gray-500">{stage.name}</div>
            <div className="flex-1 h-2 bg-gray-800 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-300 ${
                  stage.status === 'error' ? 'bg-red-500' :
                  stage.status === 'complete' ? 'bg-emerald-500' :
                  stage.status === 'active' ? 'bg-yellow-500 animate-pulse' :
                  'bg-gray-700'
                }`}
                style={{ width: `${stage.progress}%` }}
              />
            </div>
            <div className="w-5 sm:w-6 text-xs">
              {stage.status === 'complete' && <span className="text-emerald-500">✓</span>}
              {stage.status === 'error' && <span className="text-red-500">✗</span>}
              {stage.status === 'active' && <span className="text-yellow-500">⋯</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
});
