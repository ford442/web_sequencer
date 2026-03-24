import type { AISongData } from '../importers/ai-song';
import type { SavedSongData } from '../types';

export type TabType = 'paste' | 'template' | 'preview';
export type ValidationStage = 'idle' | 'parsing' | 'validating' | 'converting' | 'complete' | 'error';
export type ErrorCategory = 'JSON_SYNTAX' | 'SCHEMA_VIOLATION' | 'CONVERSION_ERROR' | 'NETWORK_ERROR';

export interface ImportStage {
  name: string;
  progress: number;
  status: 'pending' | 'active' | 'complete' | 'error';
}

export interface TrackStats {
  totalNotes: number;
  noteCounts: Record<string, number>;
  avgVelocity: number;
  velocitySum: number;
  noteCount: number;
  duration: number;
  automationLaneCount: number;
  automationPointCount: number;
  automatedParams: string[];
}

export interface FieldError {
  field: string;
  message: string;
  suggestion?: string;
}

export interface ValidationState {
  stage: ValidationStage;
  progress: number;
  fieldErrors: FieldError[];
  category?: ErrorCategory;
}

export interface DroppedFile {
  file: File;
  id: string;
  content?: string;
}

export interface AISongModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImport: (song: SavedSongData, aiData: AISongData) => void;
  onShowToast: (message: string, type: 'success' | 'error' | 'info') => void;
  audioEngine?: any;
}
