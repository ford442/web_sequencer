/**
 * SmfImportModal - Import/preview Standard MIDI Files (.mid/.midi)
 *
 * The generic DAW-interchange counterpart to RbsImportModal: drag & drop a
 * .mid file, parse it, review the import report (unmapped notes, tempo/time
 * -signature warnings, drum GM misses), then apply it to the current song.
 *
 * Mirrors RbsImportModal's structure (parse stage machine, drop zone, report
 * panel, Done/Cancel footer) at a smaller scale — SMF import needs no
 * per-track options panel, since channel routing uses fixed GM-style
 * defaults (see docs/audio-engine/SMF_IMPORT_PIPELINE.md).
 */

import React, { useCallback, useRef, useState } from 'react';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { parseSmfFile, convertToHyphonSong, type HyphonSmfSong, type SmfImportReport, type SmfParserError } from '../importers/smf';

interface SmfImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImport: (song: HyphonSmfSong) => void;
  onShowToast: (message: string, type: 'success' | 'error' | 'info') => void;
}

type Stage = 'idle' | 'reading' | 'ready' | 'error';

function errorMessage(error: SmfParserError): string {
  switch (error.type) {
    case 'INVALID_FORMAT': return error.message;
    case 'UNSUPPORTED_FORMAT': return `Format ${error.format} Standard MIDI Files (independent multi-track) are not supported — only format 0/1.`;
    case 'CORRUPTED_DATA': return `Corrupted ${error.section} chunk${error.details ? `: ${error.details}` : ''}`;
    case 'READ_ERROR': return error.message;
    default: return 'Unknown error';
  }
}

export const SmfImportModal = React.memo(function SmfImportModal({ isOpen, onClose, onImport, onShowToast }: SmfImportModalProps) {
  const [droppedFile, setDroppedFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [stage, setStage] = useState<Stage>('idle');
  const [error, setError] = useState<SmfParserError | null>(null);
  const [importReport, setImportReport] = useState<SmfImportReport | null>(null);
  const [pendingSong, setPendingSong] = useState<HyphonSmfSong | null>(null);
  const [applied, setApplied] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const modalRef = useFocusTrap<HTMLDivElement>(isOpen, onClose);

  const [prevIsOpen, setPrevIsOpen] = useState(isOpen);
  if (prevIsOpen !== isOpen) {
    setPrevIsOpen(isOpen);
    if (!isOpen) {
      setDroppedFile(null);
      setStage('idle');
      setError(null);
      setImportReport(null);
      setPendingSong(null);
      setApplied(false);
    }
  }

  const parseFile = useCallback(async (file: File) => {
    setStage('reading');
    setError(null);
    const result = await parseSmfFile(file);
    if (!result.success) {
      setStage('error');
      setError(result.error);
      onShowToast(errorMessage(result.error), 'error');
      return;
    }
    const converted = convertToHyphonSong(result.data);
    setPendingSong(converted.song);
    setImportReport(converted.report);
    setApplied(false);
    setStage('ready');
    onShowToast(`Parsed "${file.name}"`, 'success');
  }, [onShowToast]);

  const isMidFile = (name: string): boolean => {
    const lower = name.toLowerCase();
    return lower.endsWith('.mid') || lower.endsWith('.midi');
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (!file) return;
    if (!isMidFile(file.name)) {
      setStage('error');
      setError({ type: 'INVALID_FORMAT', message: `File "${file.name}" does not have a .mid/.midi extension` });
      onShowToast('Please drop a .mid file', 'error');
      return;
    }
    setDroppedFile(file);
    void parseFile(file);
  }, [parseFile, onShowToast]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!isMidFile(file.name)) {
      setStage('error');
      setError({ type: 'INVALID_FORMAT', message: `File "${file.name}" does not have a .mid/.midi extension` });
      onShowToast('Please select a .mid file', 'error');
      return;
    }
    setDroppedFile(file);
    void parseFile(file);
  }, [parseFile, onShowToast]);

  const handleApply = useCallback(() => {
    if (!pendingSong) return;
    onImport(pendingSong);
    setApplied(true);
    const report = importReport;
    if (report) {
      const parts = [`${report.notesImported} notes`, `${report.patternsCreated} pattern(s)`];
      if (report.automationLanesConverted > 0) parts.push(`${report.automationLanesConverted} automation lane(s)`);
      if (report.warnings.length > 0) parts.push(`${report.warnings.length} warning(s)`);
      onShowToast(`Imported MIDI — ${parts.join(', ')}`, report.warnings.length > 0 ? 'info' : 'success');
    }
  }, [pendingSong, importReport, onImport, onShowToast]);

  if (!isOpen) return null;

  const isReady = stage === 'ready';
  const hasError = stage === 'error';
  const isReading = stage === 'reading';
  const imported = applied;

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 z-0" onClick={onClose} aria-hidden="true" />
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="smf-import-title"
        aria-describedby="smf-import-desc"
        tabIndex={-1}
        className="relative z-10 bg-[#0f1115] border border-cyan-500/30 rounded-xl shadow-[0_0_60px_rgba(34,211,238,0.2)] w-full max-w-2xl max-h-[90vh] flex flex-col"
      >
        <div className="flex items-center justify-between p-4 border-b border-gray-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center">
              <span className="text-2xl">🎼</span>
            </div>
            <div>
              <h2 id="smf-import-title" className="text-lg font-bold text-white">Import Standard MIDI File</h2>
              <p id="smf-import-desc" className="text-xs text-gray-400">Import .mid / .midi files (format 0/1)</p>
            </div>
          </div>
          <button type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0f1115]"
            title="Close (Esc)"
            aria-label="Close modal"
          ><span aria-hidden="true">✕</span></button>
        </div>

        <div className="flex-1 overflow-auto p-4 space-y-4">
          {importReport && (
            <div data-testid="smf-import-report" className="p-4 bg-cyan-950/20 border border-cyan-900/40 rounded-lg space-y-2">
              <div className="flex items-center gap-2 text-cyan-400 text-sm font-medium">
                <span aria-hidden="true">✓</span> Import Report
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-300">
                <div>Notes imported: <span data-testid="smf-notes-imported" className="text-white">{importReport.notesImported}</span></div>
                <div>Patterns created: {importReport.patternsCreated}</div>
                <div>Format: {importReport.formatVersion}, {importReport.ppq} PPQ</div>
                <div>Tempo: {importReport.bpm} BPM</div>
                <div>Channels used: {importReport.channelsUsed.map((c) => c + 1).join(', ') || 'none'}</div>
                <div>Automation lanes: {importReport.automationLanesConverted}</div>
                {importReport.drumGmMisses > 0 && <div className="text-amber-400">Unmapped GM drum notes: {importReport.drumGmMisses}</div>}
                {importReport.timeSignatureMismatch && <div className="text-amber-400">Time signature is not 4/4</div>}
              </div>
              {importReport.warnings.length > 0 && (
                <details className="text-xs text-gray-400">
                  <summary className="cursor-pointer text-amber-400">{importReport.warnings.length} warning(s)</summary>
                  <ul className="mt-1 space-y-0.5 list-disc list-inside">
                    {importReport.warnings.map((w, i) => <li key={i}>{w}</li>)}
                  </ul>
                </details>
              )}
            </div>
          )}

          {stage === 'idle' && (
            <div
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              className={`border-2 border-dashed rounded-lg p-6 text-center transition-all ${isDragging ? 'border-cyan-500 bg-cyan-500/10' : 'border-gray-700 bg-gray-900/50 hover:border-gray-600'}`}
            >
              <div className="text-3xl mb-2">📁</div>
              <p className="text-sm text-gray-400 mb-2">{droppedFile ? droppedFile.name : 'Drag & drop a .mid file here'}</p>
              <p className="text-xs text-gray-500">or</p>
              <button type="button"
                onClick={() => fileInputRef.current?.click()}
                className="mt-2 px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs rounded transition-all"
                aria-label="Browse Files to Import"
              >
                Browse Files
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".mid,.midi"
                onChange={handleFileSelect}
                className="hidden"
                aria-label="Upload .mid file"
              />
            </div>
          )}

          {isReading && (
            <div aria-live="polite" className="p-4 bg-cyan-950/20 border border-cyan-900/30 rounded-lg flex items-center gap-2 text-cyan-400">
              <span className="animate-spin" aria-hidden="true">⏳</span>
              <span className="text-sm font-medium">Parsing {droppedFile?.name}…</span>
            </div>
          )}

          {hasError && error && (
            <div className="p-4 bg-red-950/30 border border-red-900/50 rounded-lg">
              <div className="flex items-center gap-2 text-red-400 mb-2">
                <span aria-hidden="true">⚠️</span>
                <span className="text-sm font-medium">{error.type.replace(/_/g, ' ')}</span>
              </div>
              <p className="text-sm text-red-400/80">{errorMessage(error)}</p>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between p-4 border-t border-gray-800">
          <div className="text-xs text-gray-500">
            {stage === 'idle' && 'Drop a .mid file to begin'}
            {isReading && 'Parsing…'}
            {isReady && !imported && '✓ Ready to import'}
            {hasError && `✗ ${error?.type.replace(/_/g, ' ')}`}
          </div>
          <div className="flex gap-2">
            {imported ? (
              <button type="button"
                onClick={onClose}
                className="px-4 py-2 bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-medium rounded transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0f1115]"
                aria-label="Close Import Modal"
                data-testid="smf-import-done"
              >
                ✓ Done
              </button>
            ) : (
              <>
                <button type="button"
                  onClick={onClose}
                  className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs font-medium rounded transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0f1115]"
                  aria-label="Cancel Import"
                >
                  Cancel
                </button>
                {isReady && (
                  <button type="button"
                    onClick={handleApply}
                    data-testid="smf-import-apply"
                    className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-medium rounded transition-all"
                    aria-label="Import file"
                  >
                    Import
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});
