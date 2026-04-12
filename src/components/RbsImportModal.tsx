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

export function RbsImportModal({ isOpen, onClose, onImport, onShowToast }: RbsImportModalProps) {
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
          onShowToast(`Imported "${result.song.metadata.name}" from RBS`, 'success');
          onClose();
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
  }, [parsedData, importOptions, onImport, onShowToast, onClose]);

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
      <div role="dialog" aria-modal="true" aria-labelledby="rbs-import-title" className="relative z-10 bg-[#0f1115] border border-amber-500/30 rounded-xl shadow-[0_0_60px_rgba(245,158,11,0.2)] w-full max-w-4xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center justify-center">
              <span className="text-2xl">🎹</span>
            </div>
            <div>
              <h2 id="rbs-import-title" className="text-lg font-bold text-white">Import ReBirth RB-338 File</h2>
              <p className="text-xs text-gray-400">Import .rbs pattern files from ReBirth RB-338</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white transition-all"
            title="Close (Esc)"
            aria-label="Close modal"
          >
            ✕
          </button>
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
          {/* File Drop Zone */}
          {!isComplete && !hasError && (
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
              <button
                onClick={() => fileInputRef.current?.click()}
                className="mt-2 px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs rounded transition-all"
                disabled={isParsing}
              >
                Browse Files
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".rbs"
                onChange={handleFileSelect}
                className="hidden"
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
                <button
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
                <button
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

          {/* Success / Preview */}
          {isComplete && parsedData && (
            <>
              {/* Song Metadata */}
              <div className="p-4 bg-amber-950/20 border border-amber-900/30 rounded-lg">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-medium text-amber-400">{parsedData.project.name}</h3>
                  <span className="text-xs text-gray-500">RBS {parsedData.version}</span>
                </div>
                <div className="grid grid-cols-4 gap-4 text-xs">
                  <div>
                    <span className="text-gray-500 block">Tempo</span>
                    <span className="text-white">{parsedData.project.tempo} BPM</span>
                  </div>
                  <div>
                    <span className="text-gray-500 block">Time Signature</span>
                    <span className="text-white">{parsedData.project.timeSignatureNum}/{parsedData.project.timeSignatureDen}</span>
                  </div>
                  <div>
                    <span className="text-gray-500 block">Swing</span>
                    <span className="text-white">{parsedData.project.swing}%</span>
                  </div>
                  <div>
                    <span className="text-gray-500 block">Length</span>
                    <span className="text-white">{parsedData.project.patternLength} steps</span>
                  </div>
                </div>
              </div>

              {/* Pattern Visualization */}
              {patternVisualization && (
                <div className="p-4 bg-gray-900/50 rounded-lg">
                  <h3 className="text-sm font-medium text-gray-300 mb-3">Pattern Preview</h3>
                  
                  {/* TB-303 A */}
                  <div className="mb-3">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="w-20 text-xs text-amber-500 text-right">TB-303 A</span>
                      <div className="flex gap-0.5">
                        {patternVisualization.tb303A.map((step, i) => (
                          <div
                            key={i}
                            className={`w-6 h-6 rounded-sm flex items-center justify-center text-[8px] font-mono ${
                              step.note !== -1
                                ? 'bg-amber-500/80 text-black'
                                : i % 4 === 0
                                  ? 'bg-gray-700'
                                  : 'bg-gray-800'
                            }`}
                            title={step.note !== -1 ? noteToName(step.note, step.octave) : 'Rest'}
                          >
                            {step.note !== -1 ? noteToName(step.note, step.octave).slice(0, 2) : ''}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* TB-303 B */}
                  <div className="mb-3">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="w-20 text-xs text-amber-500/70 text-right">TB-303 B</span>
                      <div className="flex gap-0.5">
                        {patternVisualization.tb303B.map((step, i) => (
                          <div
                            key={i}
                            className={`w-6 h-6 rounded-sm flex items-center justify-center text-[8px] font-mono ${
                              step.note !== -1
                                ? 'bg-amber-500/60 text-black'
                                : i % 4 === 0
                                  ? 'bg-gray-700'
                                  : 'bg-gray-800'
                            }`}
                            title={step.note !== -1 ? noteToName(step.note, step.octave) : 'Rest'}
                          >
                            {step.note !== -1 ? noteToName(step.note, step.octave).slice(0, 2) : ''}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Drums */}
                  <div className="space-y-1">
                    {[
                      { name: 'Kick', pattern: patternVisualization.drums.kick, color: 'bg-orange-500' },
                      { name: 'Snare', pattern: patternVisualization.drums.snare, color: 'bg-green-500' },
                      { name: 'Closed Hat', pattern: patternVisualization.drums.closedHat, color: 'bg-yellow-500' },
                      { name: 'Open Hat', pattern: patternVisualization.drums.openHat, color: 'bg-yellow-600' }
                    ].map(drum => (
                      <div key={drum.name} className="flex items-center gap-2">
                        <span className="w-20 text-xs text-gray-500 text-right">{drum.name}</span>
                        <div className="flex gap-0.5">
                          {drum.pattern.map((hit, i) => (
                            <div
                              key={i}
                              className={`w-6 h-4 rounded-sm ${
                                hit
                                  ? drum.color
                                  : i % 4 === 0
                                    ? 'bg-gray-700'
                                    : 'bg-gray-800'
                              }`}
                            />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>

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
              {paramSummary && (
                <div className="p-4 bg-gray-900/50 rounded-lg">
                  <h3 className="text-sm font-medium text-gray-300 mb-3">Parameter Summary</h3>
                  <div className="grid grid-cols-2 gap-4">
                    {/* TB-303 A */}
                    <div className="p-3 bg-amber-950/20 border border-amber-900/30 rounded">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-medium text-amber-400">TB-303 A</span>
                        <span className="text-[10px] text-gray-500">
                          {paramSummary.tb303A.waveform === 'saw' ? '🔺' : '⬜'} {paramSummary.tb303A.waveform}
                        </span>
                      </div>
                      <div className="space-y-1 text-xs">
                        <div className="flex justify-between">
                          <span className="text-gray-500">Cutoff</span>
                          <span className="text-gray-300">{paramSummary.tb303A.cutoff}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-500">Resonance</span>
                          <span className="text-gray-300">{paramSummary.tb303A.resonance}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-500">Decay</span>
                          <span className="text-gray-300">{paramSummary.tb303A.decay}</span>
                        </div>
                      </div>
                    </div>

                    {/* TB-303 B */}
                    <div className="p-3 bg-amber-950/20 border border-amber-900/30 rounded">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-medium text-amber-400">TB-303 B</span>
                        <span className="text-[10px] text-gray-500">
                          {paramSummary.tb303B.waveform === 'saw' ? '🔺' : '⬜'} {paramSummary.tb303B.waveform}
                        </span>
                      </div>
                      <div className="space-y-1 text-xs">
                        <div className="flex justify-between">
                          <span className="text-gray-500">Cutoff</span>
                          <span className="text-gray-300">{paramSummary.tb303B.cutoff}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-500">Resonance</span>
                          <span className="text-gray-300">{paramSummary.tb303B.resonance}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-500">Decay</span>
                          <span className="text-gray-300">{paramSummary.tb303B.decay}</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* PCF Badge */}
                  {paramSummary.pcfEnabled && (
                    <div className="mt-3 flex items-center gap-2">
                      <span className="px-2 py-1 bg-purple-500/20 text-purple-400 text-xs rounded border border-purple-500/30">
                        PCF Enabled
                      </span>
                      <span className="text-xs text-gray-500">
                        Drum Kit: {paramSummary.kitType.toUpperCase()}
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* Import Options */}
              <div className="border border-gray-800 rounded-lg overflow-hidden">
                <button
                  onClick={() => setShowOptions(!showOptions)}
                  aria-expanded={showOptions}
                  aria-controls="import-options-panel"
                  className="w-full p-3 bg-gray-900/50 flex items-center justify-between hover:bg-gray-800/50 transition-all"
                >
                  <span className="text-sm font-medium text-gray-300">Import Options</span>
                  <span className="text-gray-500">{showOptions ? '▼' : '▶'}</span>
                </button>
                
                {showOptions && (
                  <div id="import-options-panel" className="p-4 space-y-4 bg-gray-900/30">
                    {/* Expand Steps */}
                    <label className="flex items-center justify-between">
                      <span className="text-sm text-gray-400">Expand 16 → 32 steps</span>
                      <input
                        type="checkbox"
                        checked={importOptions.expandTo32Steps}
                        onChange={(e) => updateOption('expandTo32Steps', e.target.checked)}
                        className="w-4 h-4 rounded border-gray-600 bg-gray-800 text-amber-500 focus:ring-amber-500/50"
                      />
                    </label>

                    {/* Import Swing */}
                    <label className="flex items-center justify-between">
                      <span className="text-sm text-gray-400">Import swing settings</span>
                      <input
                        type="checkbox"
                        checked={importOptions.importSwing}
                        onChange={(e) => updateOption('importSwing', e.target.checked)}
                        className="w-4 h-4 rounded border-gray-600 bg-gray-800 text-amber-500 focus:ring-amber-500/50"
                      />
                    </label>

                    {/* Convert PCF */}
                    <label className="flex items-center justify-between">
                      <span className="text-sm text-gray-400">Convert PCF to automation</span>
                      <input
                        type="checkbox"
                        checked={importOptions.convertPcfToAutomation}
                        onChange={(e) => updateOption('convertPcfToAutomation', e.target.checked)}
                        className="w-4 h-4 rounded border-gray-600 bg-gray-800 text-amber-500 focus:ring-amber-500/50"
                      />
                    </label>

                    {/* Drum Kit */}
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-400">Drum kit</span>
                      <select
                        value={importOptions.drumKitMapping}
                        onChange={(e) => updateOption('drumKitMapping', e.target.value as RbsImportOptions['drumKitMapping'])}
                        className="bg-gray-800 text-gray-300 text-sm rounded px-2 py-1 border border-gray-700 focus:border-amber-500/50 outline-none"
                      >
                        <option value="auto">Auto</option>
                        <option value="808">808</option>
                        <option value="909">909</option>
                      </select>
                    </div>

                    {/* 303 A Target */}
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-400">TB-303 A target</span>
                      <select
                        value={importOptions.tb303ATarget}
                        onChange={(e) => updateOption('tb303ATarget', e.target.value as RbsImportOptions['tb303ATarget'])}
                        className="bg-gray-800 text-gray-300 text-sm rounded px-2 py-1 border border-gray-700 focus:border-amber-500/50 outline-none"
                      >
                        <option value="partA">Part A</option>
                        <option value="partB">Part B</option>
                        <option value="bass2">Bass 2 (TB-303)</option>
                      </select>
                    </div>

                    {/* 303 B Target */}
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-400">TB-303 B target</span>
                      <select
                        value={importOptions.tb303BTarget}
                        onChange={(e) => updateOption('tb303BTarget', e.target.value as RbsImportOptions['tb303BTarget'])}
                        className="bg-gray-800 text-gray-300 text-sm rounded px-2 py-1 border border-gray-700 focus:border-amber-500/50 outline-none"
                      >
                        <option value="partB">Part B</option>
                        <option value="partA">Part A</option>
                        <option value="bass2">Bass 2 (TB-303)</option>
                      </select>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-4 border-t border-gray-800">
          <div className="text-xs text-gray-500">
            {parseState.stage === 'idle' && 'Drop a .rbs file to begin'}
            {parseState.stage === 'reading' && parseState.stageLabel}
            {parseState.stage === 'parsing' && parseState.stageLabel}
            {parseState.stage === 'converting' && 'Converting...'}
            {parseState.stage === 'complete' && '✓ Ready to import'}
            {parseState.stage === 'error' && `✗ ${parseState.category?.replace(/_/g, ' ')}`}
          </div>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              disabled={isImporting}
              className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs font-medium rounded transition-all disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleImport}
              disabled={!isComplete || isImporting}
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
          </div>
        </div>
      </div>
    </div>
  );
}

export default RbsImportModal;
