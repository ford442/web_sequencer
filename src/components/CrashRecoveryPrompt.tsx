import React from 'react';
import { useFocusTrap } from '../hooks/useFocusTrap';

interface CrashRecoveryPromptProps {
  onRestore: () => void;
  onDiscard: () => void;
}

/**
 * Shown once at boot when ProjectStore detects the previous session did not
 * shut down cleanly (see useProjectAutosave / ProjectStore.wasCleanShutdown).
 * Unlike the legacy localStorage autosave, the OPFS/IndexedDB autosave keeps
 * embedded samples, so there is something worth offering to restore.
 */
export const CrashRecoveryPrompt: React.FC<CrashRecoveryPromptProps> = React.memo(
  ({ onRestore, onDiscard }) => {
    const modalRef = useFocusTrap<HTMLDivElement>(true);

    return (
      <div
        ref={modalRef}
        className="fixed top-4 left-1/2 -translate-x-1/2 z-[110] max-w-[92vw] w-[420px] px-4 py-3 rounded-lg shadow-lg border border-amber-500 bg-amber-950/95 text-amber-100 flex flex-col gap-2"
        role="alertdialog"
        aria-labelledby="crash-recovery-title"
        aria-describedby="crash-recovery-desc"
      >
        <div className="flex items-start gap-2">
          <span aria-hidden="true" className="text-lg leading-none">⚠</span>
          <div>
            <p id="crash-recovery-title" className="font-bold text-sm">
              Restore unsaved session?
            </p>
            <p id="crash-recovery-desc" className="text-xs text-amber-200/90 mt-1">
              Hyphon didn't close cleanly last time. An autosaved project — including sample banks — is available to restore.
            </p>
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-1">
          <button
            type="button"
            onClick={onDiscard}
            className="min-h-[36px] px-3 py-1 rounded-md bg-amber-900/60 hover:bg-amber-800 border border-amber-600/60 font-bold text-[10px] uppercase tracking-wider touch-manipulation focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2 focus-visible:ring-offset-amber-950 focus:outline-none"
          >
            Discard
          </button>
          <button
            type="button"
            onClick={onRestore}
            className="min-h-[36px] px-3 py-1 rounded-md bg-cyan-700 hover:bg-cyan-600 border border-cyan-400/60 font-bold text-[10px] uppercase tracking-wider touch-manipulation focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:ring-offset-2 focus-visible:ring-offset-amber-950 focus:outline-none"
            autoFocus
          >
            Restore
          </button>
        </div>
      </div>
    );
  },
);
