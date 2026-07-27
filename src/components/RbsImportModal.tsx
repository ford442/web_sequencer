/**
 * RbsImportModal - Import ReBirth RB-338 .rbs files
 * 
 * A modal dialog for importing .rbs pattern files from ReBirth RB-338
 * with preview, import options, and pattern visualization.
 * 
 * Features:
 * - Drag & drop .rbs files
 * - Parse progress display with stage labels
 * - Preview pane with pattern visualization
 * - Import options panel (expand 16→32, swing, PCF conversion, etc.)
 * - Error handling with "Try Example" feature
 */

import { ImportOptionsPanel } from './rbs-import-modal/ImportOptionsPanel';
import { ImportReportPanel } from './rbs-import-modal/ImportReportPanel';
import { SongMetadataPanel } from './rbs-import-modal/SongMetadataPanel';
import { PatternVisualization } from './rbs-import-modal/PatternVisualization';
import { ParameterSummaryPanel } from './rbs-import-modal/ParameterSummaryPanel';
import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import {
  RbsParser,
  RbsImporter,
  parseRbsFile,
  convertToHyphonSong,
  type RawRbsData,
  type HyphonSong,
  type RbsImportOptions,
  type RbsParserResult,
  type RbsParserError,
  DEFAULT_RBS_IMPORT_OPTIONS
} from '../importers/rbs';
import type { ImportReport } from '../importers/rbs';
import {
  formatFileSize,
  categorizeError,
  getErrorMessage,
  getErrorSuggestions,
  getProgressColor,
  noteToName,
  generateExampleRbsFile,
  type ParseStage,
  type ErrorCategory,
  type ParseState,
} from '../utils/rbsImportUtils';

// ============================================================================
// TYPES
// ============================================================================

interface RbsImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImport: (song: HyphonSong) => void;
  onShowToast: (message: string, type: 'success' | 'error' | 'info') => void;
}

// ============================================================================
// COMPONENT
// ============================================================================

export const RbsImportModal = React.memo(function RbsImportModal({ isOpen, onClose, onImport, onShowToast }: RbsImportModalProps) {
  // File state
  const [droppedFile, setDroppedFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  
  // Parse state
  const [parseState, setParseState] = useState<ParseState>({
    stage: 'idle',
    progress: 0,
    stageLabel: 'Waiting for file...'
  });
  
  // Parsed data
  const [parsedData, setParsedData] = useState<RawRbsData | null>(null);
  
  // Import options
  const [importOptions, setImportOptions] = useState<RbsImportOptions>(DEFAULT_RBS_IMPORT_OPTIONS);
  const [showOptions, setShowOptions] = useState(false);
  
  // Importing state
  const [isImporting, setIsImporting] = useState(false);

  // Import report state — populated after successful import
  const [importReport, setImportReport] = useState<ImportReport | null>(null);
  const [importedSongName, setImportedSongName] = useState<string>('');
  
  // Refs
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Reset state when modal opens/closes
  useEffect(() => {
    if (!isOpen) {
      setDroppedFile(null);
      setParsedData(null);
      setParseState({
        stage: 'idle',
        progress: 0,
        stageLabel: 'Waiting for file...'
      });
      setImportOptions(DEFAULT_RBS_IMPORT_OPTIONS);
      setShowOptions(false);
      setIsImporting(false);
      setImportReport(null);
      setImportedSongName('');
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
    }
  }, [isOpen]);

  // Keyboard shortcuts
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Parse file with progress
  const parseFile = useCallback(async (file: File) => {
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    try {
      // Stage 1: Reading
      setParseState({
        stage: 'reading',
        progress: 10,
        stageLabel: 'Reading header...'
      });
      await new Promise(resolve => setTimeout(resolve, 100));
      if (signal.aborted) return;

      // Stage 2: Parsing TB-303 A
      setParseState({
        stage: 'parsing',
        progress: 30,
        stageLabel: 'Parsing TB-303 A...'
      });
      await new Promise(resolve => setTimeout(resolve, 150));
      if (signal.aborted) return;

      // Stage 3: Parsing TB-303 B
      setParseState({
        stage: 'parsing',
        progress: 50,
        stageLabel: 'Parsing TB-303 B...'
      });
      await new Promise(resolve => setTimeout(resolve, 150));
      if (signal.aborted) return;

      // Stage 4: Parsing drums
      setParseState({
        stage: 'parsing',
        progress: 70,
        stageLabel: 'Parsing drum patterns...'
      });
      await new Promise(resolve => setTimeout(resolve, 150));
      if (signal.aborted) return;

      // Stage 5: Parsing PCF and automation
      setParseState({
        stage: 'parsing',
        progress: 85,
        stageLabel: 'Parsing PCF settings...'
      });
      await new Promise(resolve => setTimeout(resolve, 100));
      if (signal.aborted) return;

      // Actual parse
      const result = await parseRbsFile(file, (progress) => {
        setParseState(prev => ({
          ...prev,
          progress: Math.min(95, 85 + progress * 0.1)
        }));
      });

      if (signal.aborted) return;

      if (!result.success) {
        setParseState({
          stage: 'error',
          progress: 0,
          stageLabel: 'Parse failed',
          error: result.error,
          category: categorizeError(result.error)
        });
        onShowToast(getErrorMessage(result.error), 'error');
        return;
      }

      // Complete
      setParseState({
        stage: 'complete',
        progress: 100,
        stageLabel: 'Parse complete!'
      });
      setParsedData(result.data);
      onShowToast(`Successfully parsed "${file.name}"`, 'success');

    } catch (error) {
      if (signal.aborted) return;
      setParseState({
        stage: 'error',
        progress: 0,
        stageLabel: 'Parse error',
        error: {
          type: 'READ_ERROR',
          message: error instanceof Error ? error.message : 'Unknown error'
        },
        category: 'READ_ERROR'
      });
      onShowToast('Failed to parse file', 'error');
    }
  }, [onShowToast]);

  // Handle file drop
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const file = e.dataTransfer.files[0];
    if (!file) return;

    // Validate extension
    if (!file.name.toLowerCase().endsWith('.rbs')) {
      setParseState({
        stage: 'error',
        progress: 0,
        stageLabel: 'Invalid file type',
        error: {
          type: 'INVALID_FORMAT',
          message: `File "${file.name}" does not have .rbs extension`
        },
        category: 'INVALID_FORMAT'
      });
      onShowToast('Please drop a .rbs file', 'error');
      return;
    }

    setDroppedFile(file);
    parseFile(file);
  }, [parseFile, onShowToast]);

  // Handle file select
  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.rbs')) {
      setParseState({
        stage: 'error',
        progress: 0,
        stageLabel: 'Invalid file type',
        error: {
          type: 'INVALID_FORMAT',
          message: `File "${file.name}" does not have .rbs extension`
        },
        category: 'INVALID_FORMAT'
      });
      onShowToast('Please select a .rbs file', 'error');
      return;
    }

    setDroppedFile(file);
    parseFile(file);
  }, [parseFile, onShowToast]);

  // Cancel parsing
  const handleCancel = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setParseState({
      stage: 'idle',
      progress: 0,
      stageLabel: 'Waiting for file...'
    });
    setDroppedFile(null);
    setParsedData(null);
  }, []);

  // Load example file
  const handleLoadExample = useCallback(() => {
    const exampleFile = generateExampleRbsFile();
    setDroppedFile(exampleFile);
    parseFile(exampleFile);
    onShowToast('Loaded example RBS file', 'info');
  }, [parseFile, onShowToast]);

  // Handle import
  const handleImport = useCallback(() => {
    if (!parsedData) return;

    setIsImporting(true);
    setParseState(prev => ({
      ...prev,
      stage: 'converting',
      stageLabel: 'Converting to Hyphon format...'
    }));

    // Small delay to show the converting state
    setTimeout(() => {
      try {
        const result = convertToHyphonSong(parsedData, importOptions);
        
        if (result.success) {
          onImport(result.song);
          // Store report and song name to show in the success panel
          setImportReport(result.report);
          setImportedSongName(result.song.metadata.name);
          setIsImporting(false);
          // Show a brief summary in the toast
          const warnCount = result.report.warnings.length;
          const autoCount = result.report.automationLanesConverted;
          const summaryParts: string[] = [`${result.report.stepsConverted} steps`];
          if (autoCount > 0) summaryParts.push(`${autoCount} automation lane${autoCount !== 1 ? 's' : ''}`);
          if (warnCount > 0) summaryParts.push(`${warnCount} warning${warnCount !== 1 ? 's' : ''}`);
          onShowToast(`Imported "${result.song.metadata.name}" — ${summaryParts.join(', ')}`, 'success');
        } else {
          onShowToast('Import conversion failed', 'error');
          setIsImporting(false);
          setParseState(prev => ({
            ...prev,
            stage: 'complete',
            stageLabel: 'Parse complete!'
          }));
        }
      } catch (error) {
        onShowToast(`Import error: ${error instanceof Error ? error.message : 'Unknown'}`, 'error');
        setIsImporting(false);
        setParseState(prev => ({
          ...prev,
          stage: 'complete',
          stageLabel: 'Parse complete!'
        }));
      }
    }, 300);
  }, [parsedData, importOptions, onImport, onShowToast]);

  // Update import option
  const updateOption = useCallback(<K extends keyof RbsImportOptions>(
    key: K,
    value: RbsImportOptions[K]
  ) => {
    setImportOptions(prev => ({ ...prev, [key]: value }));
  }, []);

  // Derived state
  const hasError = parseState.stage === 'error';
  const isComplete = parseState.stage === 'complete';
  const isParsing = parseState.stage === 'reading' || parseState.stage === 'parsing';

  // Pattern visualization data
  const patternVisualization = useMemo(() => {
    if (!parsedData) return null;

    return {
      tb303A: parsedData.tb303PatternA.steps.slice(0, 16),
      tb303B: parsedData.tb303PatternB.steps.slice(0, 16),
      drums: {
        kick: parsedData.drums.kick.slice(0, 16),
        snare: parsedData.drums.snare.slice(0, 16),
        closedHat: parsedData.drums.closedHat.slice(0, 16),
        openHat: parsedData.drums.openHat.slice(0, 16)
      },
      pcf: parsedData.pcf.enabled ? parsedData.pcf.pattern.slice(0, 16) : null
    };
  }, [parsedData]);

  // Parameter summary
  const paramSummary = useMemo(() => {
    if (!parsedData) return null;

    return {
      tb303A: {
        cutoff: parsedData.tb303PatternA.cutoff,
        resonance: parsedData.tb303PatternA.resonance,
        decay: parsedData.tb303PatternA.decay,
        waveform: parsedData.tb303PatternA.waveform === 0 ? 'saw' : 'square'
      },
      tb303B: {
        cutoff: parsedData.tb303PatternB.cutoff,
        resonance: parsedData.tb303PatternB.resonance,
        decay: parsedData.tb303PatternB.decay,
        waveform: parsedData.tb303PatternB.waveform === 0 ? 'saw' : 'square'
      },
      pcfEnabled: parsedData.pcf.enabled,
      kitType: parsedData.drums.kitType
    };
  }, [parsedData]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4"
    >
      <div
        className="absolute inset-0 z-0"
        onClick={onClose}
        aria-hidden="true"
      />
      <div role="dialog" aria-modal="true" aria-labelledby="rbs-import-title" aria-describedby="rbs-import-desc" tabIndex={-1} className="relative z-10 bg-[#0f1115] border border-amber-500/30 rounded-xl shadow-[0_0_60px_rgba(245,158,11,0.2)] w-full max-w-4xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center justify-center">
              <span className="text-2xl">🎹</span>
            </div>
            <div>
              <h2 id="rbs-import-title" className="text-lg font-bold text-white">Import ReBirth RB-338 File</h2>
              <p id="rbs-import-desc" className="text-xs text-gray-400">Import .rbs pattern files from ReBirth RB-338</p>
            </div>
          </div>
          <button type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0f1115]"
            title="Close (Esc)"
            aria-label="Close modal"
          ><span aria-hidden="true">✕</span></button>
        </div>

        {/* Progress Bar */}
        <div className={`h-1 w-full transition-colors duration-300 ${getProgressColor(parseState.stage)}`}>
          <div
            className="h-full bg-white/30 transition-all duration-300"
            style={{ width: `${parseState.progress}%` }}
          />
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-4 space-y-4">
          {/* Import Report */}
          {importReport && (
            <ImportReportPanel importReport={importReport} importedSongName={importedSongName} />
          )}

          {/* File Drop Zone */}
          {!isComplete && !hasError && !importReport && (
            <div
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              className={`border-2 border-dashed rounded-lg p-6 text-center transition-all ${
                isDragging
                  ? 'border-amber-500 bg-amber-500/10'
                  : 'border-gray-700 bg-gray-900/50 hover:border-gray-600'
              }`}
            >
              <div className="text-3xl mb-2">📁</div>
              <p className="text-sm text-gray-400 mb-2">
                {droppedFile ? droppedFile.name : 'Drag & drop a .rbs file here'}
              </p>
              {droppedFile && (
                <p className="text-xs text-amber-400 mb-2">
                  {formatFileSize(droppedFile.size)}
                </p>
              )}
              <p className="text-xs text-gray-500">or</p>
              <button type="button"
                onClick={() => fileInputRef.current?.click()}
                className="mt-2 px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs rounded transition-all"
                disabled={isParsing}
                aria-label="Browse Files to Import"
              >
                Browse Files
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".rbs"
                onChange={handleFileSelect}
                className="hidden"
                aria-label="Upload .rbs file"
              />
            </div>
          )}

          {/* Parse Progress */}
          {isParsing && (
            <div aria-live="polite" className="p-4 bg-amber-950/20 border border-amber-900/30 rounded-lg">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2 text-amber-400">
                  <span className="animate-spin">⏳</span>
                  <span className="text-sm font-medium">{parseState.stageLabel}</span>
                </div>
                <button type="button"
                  onClick={handleCancel}
                  className="px-3 py-1 bg-gray-800 hover:bg-gray-700 text-gray-400 text-xs rounded transition-all"
                >
                  Cancel
                </button>
              </div>
              <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-amber-500 to-amber-400 rounded-full transition-all duration-300"
                  style={{ width: `${parseState.progress}%` }}
                />
              </div>
              <div className="mt-2 flex justify-between text-xs text-gray-500">
                <span>Reading file...</span>
                <span>{Math.round(parseState.progress)}%</span>
              </div>
            </div>
          )}

          {/* Error Display */}
          {hasError && parseState.error && (
            <div className="p-4 bg-red-950/30 border border-red-900/50 rounded-lg">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2 text-red-400">
                  <span>⚠️</span>
                  <span className="text-sm font-medium">
                    {parseState.category === 'INVALID_FORMAT' && 'Invalid Format'}
                    {parseState.category === 'CORRUPTED_DATA' && 'Corrupted File'}
                    {parseState.category === 'UNSUPPORTED_VERSION' && 'Unsupported Version'}
                    {parseState.category === 'READ_ERROR' && 'Read Error'}
                  </span>
                </div>
                <button type="button"
                  onClick={handleLoadExample}
                  className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white text-xs rounded transition-all"
                >
                  Try Example File
                </button>
              </div>
              
              <p className="text-sm text-red-400/80 mb-3">
                {getErrorMessage(parseState.error)}
              </p>

              {/* Suggestions */}
              {parseState.category && (
                <div className="mt-3 pt-3 border-t border-red-900/30">
                  <p className="text-xs text-gray-500 mb-1">Suggestions:</p>
                  <ul className="text-xs text-gray-400 space-y-0.5 list-disc list-inside">
                    {getErrorSuggestions(parseState.category).map((suggestion, idx) => (
                      <li key={idx}>{suggestion}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Success / Preview — hidden once import is done */}
          {isComplete && parsedData && !importReport && (
            <>
              {/* Song Metadata */}
              <SongMetadataPanel project={parsedData.project} version={parsedData.version} />

              {/* Pattern Visualization */}
              {patternVisualization && (
                <div className="p-4 bg-gray-900/50 rounded-lg">
                  <h3 className="text-sm font-medium text-gray-300 mb-3">Pattern Preview</h3>
                  
                  <PatternVisualization tb303A={patternVisualization.tb303A} tb303B={patternVisualization.tb303B} drums={patternVisualization.drums} />

                  {/* PCF Indicator */}
                  {patternVisualization.pcf && (
                    <div className="mt-3 pt-3 border-t border-gray-800">
                      <div className="flex items-center gap-2">
                        <span className="w-20 text-xs text-purple-400 text-right">PCF</span>
                        <div className="flex gap-0.5">
                          {patternVisualization.pcf.map((value, i) => (
                            <div
                              key={i}
                              className="w-6 h-3 rounded-sm"
                              style={{
                                backgroundColor: `rgba(168, 85, 247, ${value / 127})`
                              }}
                            />
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Parameter Summary */}
              <ParameterSummaryPanel paramSummary={paramSummary} />

              {/* Import Options */}
              <ImportOptionsPanel
                importOptions={importOptions}
                updateOption={updateOption}
                showOptions={showOptions}
                setShowOptions={setShowOptions}
              />
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-4 border-t border-gray-800">
          <div className="text-xs text-gray-500">
            {importReport && `✓ Imported "${importedSongName}"`}
            {!importReport && parseState.stage === 'idle' && 'Drop a .rbs file to begin'}
            {!importReport && parseState.stage === 'reading' && parseState.stageLabel}
            {!importReport && parseState.stage === 'parsing' && parseState.stageLabel}
            {!importReport && parseState.stage === 'converting' && 'Converting...'}
            {!importReport && parseState.stage === 'complete' && '✓ Ready to import'}
            {!importReport && parseState.stage === 'error' && `✗ ${parseState.category?.replace(/_/g, ' ')}`}
          </div>
          <div className="flex gap-2">
            {importReport ? (
              <button type="button"
                onClick={onClose}
                className="px-4 py-2 bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-medium rounded transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0f1115]"
                aria-label="Close Import Modal"
                data-testid="rbs-import-done"
              >
                ✓ Done
              </button>
            ) : (
              <>
                <button type="button"
                  onClick={onClose}
                  disabled={isImporting}
                  className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs font-medium rounded transition-all disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0f1115]"
                  aria-label="Cancel Import"
                >
                  Cancel
                </button>
                <button type="button"
                  onClick={handleImport}
                  disabled={!isComplete || isImporting}
                  title={!isComplete ? 'Select a valid file first' : isImporting ? 'Importing file...' : 'Import file'}
                  aria-busy={isImporting}
                  className={`px-4 py-2 text-xs font-medium rounded transition-all flex items-center gap-2 ${
                    isComplete && !isImporting
                      ? 'bg-amber-600 hover:bg-amber-500 text-white'
                      : 'bg-gray-700 text-gray-500 cursor-not-allowed'
                  }`}
                >
                  {isImporting ? (
                    <>
                      <span className="animate-spin">⏳</span>
                      Importing...
                    </>
                  ) : (
                    <>
                      <span>🎵</span>
                      Import Song
                    </>
                  )}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});

export default RbsImportModal;
