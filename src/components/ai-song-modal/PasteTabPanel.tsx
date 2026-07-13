import React from 'react';
import type { AISongData } from '../../importers/ai-song';
import type { DroppedFile, ValidationState } from '../../types/aiSongModal';
import { EXAMPLES } from '../../constants/aiSongExamples';
import { getTextareaBorderColor } from '../../utils/aiSongUtils';
import { Tooltip } from './Tooltip';
import { DropZone } from './DropZone';
import { ValidationProgress, ValidationErrorDisplay, ValidationSuccessDisplay } from './ValidationDisplay';

interface PasteTabPanelProps {
  jsonInput: string;
  validationState: ValidationState;
  hasErrors: boolean;
  isValid: boolean;
  parsedData: AISongData | null;
  isDragging: boolean;
  droppedFiles: DroppedFile[];
  showFixSuccess: boolean;
  copiedError: boolean;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onJsonChange: (value: string) => void;
  onImport: () => void;
  onFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onRemoveFile: (id: string) => void;
  onLoadExample: (key: keyof typeof EXAMPLES) => void;
  onFixCommonIssues: () => void;
  onCopyErrorReport: () => void;
  parsedTracksElements: React.ReactNode;
  parsedAutomationLanesList: React.ReactNode;
}

export const PasteTabPanel = React.memo(function PasteTabPanel({
  jsonInput,
  validationState,
  hasErrors,
  isValid,
  parsedData,
  isDragging,
  droppedFiles,
  showFixSuccess,
  copiedError,
  textareaRef,
  fileInputRef,
  onJsonChange,
  onImport,
  onFileSelect,
  onRemoveFile,
  onLoadExample,
  onFixCommonIssues,
  onCopyErrorReport,
  parsedTracksElements,
  parsedAutomationLanesList,
}: PasteTabPanelProps) {
  // @ts-expect-error - Auto-generated to fix CI build
  const textareaBorderColor = getTextareaBorderColor(validationState, jsonInput.trim().length > 0);

  return (
    <div id="ai-modal-panel-paste" role="tabpanel" aria-labelledby="ai-modal-tab-paste" className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2">
        <span className="text-xs text-gray-500 py-1 sm:py-2">Try with example:</span>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(EXAMPLES) as Array<keyof typeof EXAMPLES>).map(key => (
            <Tooltip key={key} text={EXAMPLES[key].desc} position="bottom">
              <button type="button"
                onClick={() => onLoadExample(key)}
                className="px-2 sm:px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs rounded transition-all border border-gray-700 hover:border-emerald-500/50 flex items-center gap-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0f1115]"
              >
                <span>{EXAMPLES[key].emoji}</span>
                <span className="hidden sm:inline">{EXAMPLES[key].name.split(' ').slice(1).join(' ')}</span>
                <span className="sm:hidden">{key === 'dnb' ? 'DnB' : key.charAt(0).toUpperCase() + key.slice(1)}</span>
              </button>
            </Tooltip>
          ))}
        </div>
      </div>

      <DropZone
        isDragging={isDragging}
        droppedFiles={droppedFiles}
        fileInputRef={fileInputRef}
        onFileSelect={onFileSelect}
        onRemoveFile={onRemoveFile}
      />

      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-xs text-gray-500">Or paste JSON directly:</label>
          <div className="flex items-center gap-2">
            {validationState.stage !== 'idle' && (
              <span className={`text-xs ${
                validationState.stage === 'complete' ? 'text-emerald-400' :
                validationState.stage === 'error' ? 'text-red-400' :
                'text-yellow-400'
              }`}>
                {validationState.stage === 'complete' && '✓ Valid JSON'}
                {validationState.stage === 'error' && `✗ ${validationState.fieldErrors.length} error(s)`}
                {(validationState.stage === 'parsing' || validationState.stage === 'validating') && '⏳ Validating...'}
              </span>
            )}
            <span className="text-xs text-gray-600">Ctrl+V to paste</span>
          </div>
        </div>
        <textarea
          ref={textareaRef}
          value={jsonInput}
          onChange={(e) => onJsonChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && parsedData) {
              e.preventDefault();
              onImport();
            }
          }}
          placeholder={`{\n  "meta": {\n    "title": "My AI Song",\n    "author": "claude",\n    "version": "1.0",\n    ...\n  }\n}`}
          className={`w-full h-32 sm:h-40 bg-[#0a0c10] border ${textareaBorderColor} rounded-lg p-3 text-xs font-mono text-gray-300 resize-none focus:outline-none transition-colors duration-300`}
          spellCheck={false}
        />
        {parsedData && (
          <p className="text-[10px] text-emerald-500/70 mt-1 text-right">
            Press Ctrl+Enter to import
          </p>
        )}
      </div>

      <ValidationProgress validationState={validationState} />

      {hasErrors && (
        <ValidationErrorDisplay
          validationState={validationState}
          showFixSuccess={showFixSuccess}
          copiedError={copiedError}
          onFixCommonIssues={onFixCommonIssues}
          onCopyErrorReport={onCopyErrorReport}
        />
      )}

      {isValid && parsedData && (
        <ValidationSuccessDisplay
          parsedData={parsedData}
          parsedTracksElements={parsedTracksElements}
          parsedAutomationLanesList={parsedAutomationLanesList}
        />
      )}
    </div>
  );
});
