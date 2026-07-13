import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import {
  AISongImporter,
  parseAISongJSON,
  type AISongData,
} from '../../importers/ai-song';
import type {
  TabType,
  ValidationState,
  ImportStage,
  DroppedFile,
  FieldError,
  TrackStats,
  AISongModalProps,
} from '../../types/aiSongModal';
import { PROMPT_TEMPLATE, EXAMPLES } from '../../constants/aiSongExamples';
import {
  generateId,
  fixCommonJsonIssues,
  categorizeError,
} from '../../utils/aiSongUtils';

const INITIAL_IMPORT_STAGES: ImportStage[] = [
  { name: 'Parse', progress: 0, status: 'pending' },
  { name: 'Validate', progress: 0, status: 'pending' },
  { name: 'Convert', progress: 0, status: 'pending' },
  { name: 'Upload', progress: 0, status: 'pending' },
  { name: 'Complete', progress: 0, status: 'pending' },
];

export function useAISongModal({
  isOpen,
  onClose,
  onImport,
  onShowToast,
}: Pick<AISongModalProps, 'isOpen' | 'onClose' | 'onImport' | 'onShowToast'>) {
  const [jsonInput, setJsonInput] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [dragCounter, setDragCounter] = useState(0);
  const [parsedData, setParsedData] = useState<AISongData | null>(null);
  const [validationState, setValidationState] = useState<ValidationState>({
    stage: 'idle',
    progress: 0,
    fieldErrors: [],
  });
  const [isImporting, setIsImporting] = useState(false);
  const [activeTab, setActiveTab] = useState<TabType>('paste');
  const [importStages, setImportStages] = useState<ImportStage[]>(INITIAL_IMPORT_STAGES);
  const [droppedFiles, setDroppedFiles] = useState<DroppedFile[]>([]);
  const [showFixSuccess, setShowFixSuccess] = useState(false);
  const [copiedError, setCopiedError] = useState(false);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) {
      setJsonInput('');
      setParsedData(null);
      setValidationState({ stage: 'idle', progress: 0, fieldErrors: [] });
      setIsImporting(false);
      setActiveTab('paste');
      setImportStages(INITIAL_IMPORT_STAGES.map(s => ({ ...s })));
      setDroppedFiles([]);
      setShowFixSuccess(false);
      setCopiedError(false);
      setIsPreviewLoading(false);
      setHasUnsavedChanges(false);
      setShowCloseConfirm(false);
      setDragCounter(0);
    }
  }, [isOpen]);

  useEffect(() => {
    if (jsonInput.trim() || droppedFiles.length > 0) {
      setHasUnsavedChanges(true);
    }
  }, [jsonInput, droppedFiles]);

  const handleClose = useCallback(() => {
    if (hasUnsavedChanges) {
      setShowCloseConfirm(true);
      setTimeout(() => setShowCloseConfirm(false), 3000);
      return;
    }
    onClose();
  }, [hasUnsavedChanges, onClose]);

  const confirmClose = useCallback(() => {
    setShowCloseConfirm(false);
    setHasUnsavedChanges(false);
    onClose();
  }, [onClose]);

  const handleJsonChange = useCallback(async (value: string, skipProgress = false) => {
    setJsonInput(value);
    setParsedData(null);
    setValidationState({ stage: 'idle', progress: 0, fieldErrors: [] });
    setShowFixSuccess(false);

    if (!value.trim()) {
      setValidationState({ stage: 'idle', progress: 0, fieldErrors: [] });
      return;
    }

    if (!skipProgress) {
      setValidationState({ stage: 'parsing', progress: 25, fieldErrors: [] });
      onShowToast('ℹ Validating...', 'info');
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    const parseResult = parseAISongJSON(value);
    if (!parseResult.success) {
      const category = categorizeError(parseResult.error);
      setValidationState({
        stage: 'error',
        progress: 0,
        fieldErrors: [{ field: 'JSON', message: parseResult.error }],
        category,
      });
      onShowToast(`✗ ${parseResult.error}`, 'error');
      return;
    }

    if (!skipProgress) {
      setValidationState({ stage: 'validating', progress: 50, fieldErrors: [] });
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    const importer = new AISongImporter();
    const result = importer.convert(parseResult.data);

    if (!skipProgress) {
      setValidationState({ stage: 'converting', progress: 75, fieldErrors: [] });
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    if (!result.success) {
      const fieldErrors: FieldError[] = [];
      const error = result.error;

      if (error.type === 'VALIDATION_ERROR') {
        fieldErrors.push({
          field: error.field,
          message: error.message,
          suggestion: error.field.includes('tempo') ? 'Use a value between 30-300' : undefined,
        });
      } else if (error.type === 'CONVERSION_ERROR') {
        fieldErrors.push({ field: error.track, message: error.details });
      } else if (error.type === 'INVALID_NOTE') {
        fieldErrors.push({
          field: `tracks.${error.track}`,
          message: `Invalid note: "${error.note}"`,
          suggestion: 'Use format like "C4", "F#3", "Bb2"',
        });
      } else {
        fieldErrors.push({ field: error.type, message: JSON.stringify(error) });
      }

      const category = categorizeError(error);
      setValidationState({ stage: 'error', progress: 0, fieldErrors, category });
      onShowToast(`✗ Import failed: ${error.type}`, 'error');
      return;
    }

    setValidationState({ stage: 'complete', progress: 100, fieldErrors: [], category: undefined });
    setParsedData(parseResult.data);
    onShowToast(`✓ Valid: "${parseResult.data.meta.title}"`, 'success');
  }, [onShowToast]);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragCounter(prev => prev + 1);
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragCounter(prev => {
      const newCount = prev - 1;
      if (newCount <= 0) {
        setIsDragging(false);
        return 0;
      }
      return newCount;
    });
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    setDragCounter(0);

    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;

    const jsonFiles = files.filter(
      file => file.type === 'application/json' || file.name.endsWith('.json')
    );

    if (jsonFiles.length === 0) {
      setValidationState({
        stage: 'error',
        progress: 0,
        fieldErrors: [{ field: 'file', message: 'Please drop .json files only' }],
        category: 'JSON_SYNTAX',
      });
      onShowToast('✗ Only .json files are supported', 'error');
      return;
    }

    jsonFiles.forEach((file, index) => {
      const reader = new FileReader();
      const fileId = generateId();

      reader.onload = (event) => {
        const content = event.target?.result as string;
        if (content) {
          setDroppedFiles(prev => [...prev, { file, id: fileId, content }]);
          if (index === 0) {
            handleJsonChange(content);
            setJsonInput(content);
          }
        }
      };

      reader.onerror = () => {
        onShowToast(`✗ Failed to read ${file.name}`, 'error');
      };

      reader.readAsText(file);
    });

    onShowToast(`ℹ Uploading ${jsonFiles.length} file(s)...`, 'info');
  }, [handleJsonChange, onShowToast]);

  const removeDroppedFile = useCallback((id: string) => {
    setDroppedFiles(prev => {
      const filtered = prev.filter(f => f.id !== id);
      if (prev[0]?.id === id && filtered.length > 0) {
        const nextFile = filtered[0];
        if (nextFile.content) {
          setJsonInput(nextFile.content);
          handleJsonChange(nextFile.content);
        }
      } else if (filtered.length === 0) {
        setJsonInput('');
        setParsedData(null);
        setValidationState({ stage: 'idle', progress: 0, fieldErrors: [] });
      }
      return filtered;
    });
  }, [handleJsonChange]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    files.forEach((file, index) => {
      const reader = new FileReader();
      const fileId = generateId();

      reader.onload = (event) => {
        const content = event.target?.result as string;
        if (content) {
          setDroppedFiles(prev => [...prev, { file, id: fileId, content }]);
          if (index === 0) {
            handleJsonChange(content);
            setJsonInput(content);
          }
        }
      };

      reader.readAsText(file);
    });

    e.target.value = '';
  }, [handleJsonChange]);

  const handleImport = useCallback(async () => {
    if (!parsedData) return;

    setIsImporting(true);
    onShowToast('ℹ Uploading to cloud...', 'info');

    const updateStage = (index: number, status: ImportStage['status'], progress: number) => {
      setImportStages(prev => prev.map((stage, i) =>
        i === index ? { ...stage, status, progress } :
        i < index ? { ...stage, status: 'complete', progress: 100 } :
        stage
      ));
    };

    try {
      updateStage(0, 'active', 50);
      await new Promise(resolve => setTimeout(resolve, 200));
      updateStage(0, 'complete', 100);

      updateStage(1, 'active', 50);
      const importer = new AISongImporter();
      const result = importer.convert(parsedData);
      await new Promise(resolve => setTimeout(resolve, 200));

      if (!result.success) {
        updateStage(1, 'error', 0);
        onShowToast(`✗ Import failed: ${result.error.type}`, 'error');
        setIsImporting(false);
        return;
      }
      updateStage(1, 'complete', 100);

      updateStage(2, 'active', 50);
      await new Promise(resolve => setTimeout(resolve, 200));
      updateStage(2, 'complete', 100);

      updateStage(3, 'active', 50);
      const uploadResult = await importer.uploadToCloud(parsedData, result.song);

      if (uploadResult.success) {
        updateStage(3, 'complete', 100);
        onShowToast(`✓ Song '${parsedData.meta.title}' uploaded to cloud`, 'success');
      } else {
        updateStage(3, 'error', 0);
        onShowToast('ℹ Song imported locally (cloud upload failed)', 'info');
      }

      updateStage(4, 'complete', 100);
      await new Promise(resolve => setTimeout(resolve, 300));

      onImport(result.song, parsedData);
      onShowToast(`✓ Song '${parsedData.meta.title}' imported successfully`, 'success');
      onClose();
    } catch (error) {
      setImportStages(prev => prev.map((stage, i) =>
        i === 3 ? { ...stage, status: 'error', progress: 0 } : stage
      ));
      onShowToast(`✗ Import error: ${error instanceof Error ? error.message : 'Unknown'}`, 'error');
    } finally {
      setIsImporting(false);
    }
  }, [parsedData, onImport, onClose, onShowToast]);

  const copyTemplate = useCallback(() => {
    navigator.clipboard.writeText(PROMPT_TEMPLATE);
    onShowToast('✓ Prompt template copied!', 'success');
  }, [onShowToast]);

  const loadExample = useCallback((exampleKey: keyof typeof EXAMPLES) => {
    const example = EXAMPLES[exampleKey];
    const json = JSON.stringify(example.data, null, 2);
    setJsonInput(json);
    handleJsonChange(json, true);
    onShowToast(`ℹ Loaded "${example.name}" example`, 'info');
  }, [handleJsonChange, onShowToast]);

  const handleFixCommonIssues = useCallback(async () => {
    const { fixed, changes } = fixCommonJsonIssues(jsonInput);
    if (changes.length > 0) {
      setJsonInput(fixed);
      await handleJsonChange(fixed, true);
      setShowFixSuccess(true);
      onShowToast(`✓ Fixed ${changes.length} issue(s)`, 'success');
      setTimeout(() => setShowFixSuccess(false), 3000);
    } else {
      onShowToast('ℹ No common issues found', 'info');
    }
  }, [jsonInput, handleJsonChange, onShowToast]);

  const copyErrorReport = useCallback(() => {
    const report = {
      timestamp: new Date().toISOString(),
      category: validationState.category,
      errors: validationState.fieldErrors,
      inputPreview: jsonInput.substring(0, 500) + (jsonInput.length > 500 ? '...' : ''),
    };
    navigator.clipboard.writeText(JSON.stringify(report, null, 2));
    setCopiedError(true);
    onShowToast('✓ Error report copied!', 'success');
    setTimeout(() => setCopiedError(false), 2000);
  }, [validationState, jsonInput, onShowToast]);

  const trackStats = useMemo<TrackStats | null>(() => {
    if (!parsedData) return null;

    const stats: TrackStats = {
      totalNotes: 0,
      noteCounts: {},
      avgVelocity: 0,
      velocitySum: 0,
      noteCount: 0,
      duration: 0,
      automationLaneCount: 0,
      automationPointCount: 0,
      automatedParams: [],
    };

    ['synthA', 'synthB', 'bass2'].forEach(track => {
      const trackData = parsedData.tracks[track as keyof typeof parsedData.tracks];
      if (trackData && 'notes' in trackData && Array.isArray(trackData.notes)) {
        const count = trackData.notes.length;
        stats.noteCounts[track] = count;
        stats.totalNotes += count;
        trackData.notes.forEach((note: { velocity?: number }) => {
          if (note.velocity) {
            stats.velocitySum += note.velocity;
            stats.noteCount++;
          }
        });
      }
    });

    ['kick', 'snare', 'closedHat', 'openHat'].forEach(track => {
      const trackData = parsedData.tracks[track as keyof typeof parsedData.tracks];
      if (Array.isArray(trackData)) {
        const count = trackData.filter(Boolean).length;
        stats.noteCounts[track] = count;
        stats.totalNotes += count;
      }
    });

    if (parsedData.tracks.sampler) {
      parsedData.tracks.sampler.forEach((bank) => {
        const count = bank.steps.length;
        stats.noteCounts[`sampler${bank.bankIndex}`] = count;
        stats.totalNotes += count;
        bank.steps.forEach((note: { velocity?: number }) => {
          if (note.velocity) {
            stats.velocitySum += note.velocity;
            stats.noteCount++;
          }
        });
      });
    }

    stats.avgVelocity = stats.noteCount > 0 ? stats.velocitySum / stats.noteCount : 0;

    const stepsPerPattern = 32;
    const secondsPerStep = 60 / parsedData.globals.tempo / 4;
    stats.duration = stepsPerPattern * secondsPerStep;

    if (parsedData.automation && parsedData.automation.length > 0) {
      stats.automationLaneCount = parsedData.automation.length;
      parsedData.automation.forEach(lane => {
        const pointCount = lane.steps.filter(s => s !== null).length;
        stats.automationPointCount += pointCount;
        stats.automatedParams.push(`${lane.target}.${lane.parameter}`);
      });
    }

    return stats;
  }, [parsedData]);

  const patternGrid = useMemo(() => {
    if (!parsedData) return null;

    const tracks = ['synthA', 'synthB', 'bass2', 'kick', 'snare', 'closedHat', 'openHat', 'sampler0'];
    const grid: boolean[][] = [];

    tracks.forEach((trackName) => {
      const row: boolean[] = Array(32).fill(false);

      if (trackName === 'sampler0' && parsedData.tracks.sampler?.[0]) {
        parsedData.tracks.sampler[0].steps.forEach((note: { step: number }) => {
          if (note.step >= 0 && note.step < 32) row[note.step] = true;
        });
      } else if (trackName in parsedData.tracks) {
        const trackData = parsedData.tracks[trackName as keyof typeof parsedData.tracks];
        if (trackData && 'notes' in trackData && Array.isArray(trackData.notes)) {
          trackData.notes.forEach((note: { step: number }) => {
            if (note.step >= 0 && note.step < 32) row[note.step] = true;
          });
        } else if (Array.isArray(trackData)) {
          trackData.forEach((hit, i) => {
            if (i < 32 && hit) row[i] = true;
          });
        }
      }

      grid.push(row);
    });

    return { tracks, grid };
  }, [parsedData]);

  const loadPreview = useCallback(() => {
    if (!parsedData) return;
    setIsPreviewLoading(true);
    setTimeout(() => {
      setIsPreviewLoading(false);
    }, 500);
  }, [parsedData]);

  useEffect(() => {
    if (activeTab === 'preview' && parsedData) {
      loadPreview();
    }
  }, [activeTab, parsedData, loadPreview]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'v' && activeTab === 'paste') {
        e.preventDefault();
        textareaRef.current?.focus();
        setTimeout(() => {
          onShowToast('📋 Pasted to editor', 'info');
        }, 100);
      }

      if (e.key === 'Escape') {
        if (hasUnsavedChanges && !showCloseConfirm) {
          e.preventDefault();
          setShowCloseConfirm(true);
          setTimeout(() => setShowCloseConfirm(false), 3000);
        } else {
          handleClose();
        }
      }

      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && parsedData && !isImporting) {
        e.preventDefault();
        handleImport();
      }

      if (e.key === 'Tab' && !e.shiftKey && e.target === document.activeElement) {
        if (document.activeElement !== textareaRef.current) {
          e.preventDefault();
          const tabs: TabType[] = ['paste', 'template', 'preview'];
          const currentIndex = tabs.indexOf(activeTab);
          const nextIndex = (currentIndex + 1) % tabs.length;
          if (tabs[nextIndex] === 'preview' && !parsedData) {
            setActiveTab('paste');
          } else {
            setActiveTab(tabs[nextIndex]);
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, activeTab, hasUnsavedChanges, showCloseConfirm, parsedData, isImporting, onShowToast, handleClose, handleImport]);

  const hasErrors = validationState.stage === 'error' && validationState.fieldErrors.length > 0;
  const isValid = validationState.stage === 'complete' && parsedData !== null;

  return {
    jsonInput,
    isDragging,
    dragCounter,
    parsedData,
    validationState,
    isImporting,
    activeTab,
    setActiveTab,
    importStages,
    droppedFiles,
    showFixSuccess,
    copiedError,
    isPreviewLoading,
    showCloseConfirm,
    setShowCloseConfirm,
    textareaRef,
    fileInputRef,
    modalRef,
    handleClose,
    confirmClose,
    handleJsonChange,
    handleDragEnter,
    handleDragLeave,
    handleDrop,
    removeDroppedFile,
    handleFileSelect,
    handleImport,
    copyTemplate,
    loadExample,
    handleFixCommonIssues,
    copyErrorReport,
    trackStats,
    patternGrid,
    hasErrors,
    isValid,
  };
}
