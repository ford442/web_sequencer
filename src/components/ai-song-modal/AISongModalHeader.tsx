import React from 'react';
import type { ValidationState } from '../../types/aiSongModal';
import { getValidationColor } from '../../utils/aiSongUtils';
import { Tooltip } from './Tooltip';

interface AISongModalHeaderProps {
  onClose: () => void;
  validationState: ValidationState;
  showCloseConfirm: boolean;
  onDismissCloseConfirm: () => void;
  onConfirmClose: () => void;
}

export const AISongModalHeader = React.memo(function AISongModalHeader({
  onClose,
  validationState,
  showCloseConfirm,
  onDismissCloseConfirm,
  onConfirmClose,
}: AISongModalHeaderProps) {
  return (
    <>
      <div className="flex items-center justify-between p-3 sm:p-4 border-b border-gray-800">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center">
            <span className="text-xl sm:text-2xl">🤖</span>
          </div>
          <div>
            <h2 id="ai-song-modal-title" className="text-base sm:text-lg font-bold text-white">Import AI Song</h2>
            <p id="ai-song-modal-desc" className="text-[10px] sm:text-xs text-gray-400 hidden sm:block">Import songs from Claude, Gemini, Jules, Copilot, etc.</p>
          </div>
        </div>
        <Tooltip text="Close (Esc)" position="bottom">
          <button type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0f1115]"
            aria-label="Close modal"
            title="Close modal"
          ><span aria-hidden="true">✕</span></button>
        </Tooltip>
      </div>

      <div className={`h-1 w-full transition-colors duration-300 ${getValidationColor(validationState.stage)} ${(validationState.stage === 'parsing' || validationState.stage === 'validating') ? 'animate-pulse' : ''}`}>
        <div
          className="h-full bg-white/30 transition-all duration-300"
          style={{ width: `${validationState.progress}%` }}
        />
      </div>

      {showCloseConfirm && (
        <div className="px-4 py-2 bg-yellow-950/50 border-b border-yellow-900/50 flex items-center justify-between animate-in slide-in-from-top-2">
          <span className="text-xs text-yellow-400">You have unsaved changes. Close anyway?</span>
          <div className="flex gap-2">
            <button type="button"
              onClick={onDismissCloseConfirm}
              className="px-2 py-1 text-xs text-gray-400 hover:text-white hover:bg-gray-800 rounded transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0f1115]"
              aria-label="Cancel closing modal"
            >
              Cancel
            </button>
            <button type="button"
              onClick={onConfirmClose}
              className="px-2 py-1 text-xs bg-red-600 hover:bg-red-500 text-white rounded transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0f1115]"
              aria-label="Confirm close modal"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </>
  );
});
