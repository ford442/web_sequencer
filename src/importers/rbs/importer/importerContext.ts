import type { RbsImportOptions, StepConversionStats } from '../types';

/** Mutable context passed to importer helper modules. */
export interface ImporterContext {
  options: RbsImportOptions;
  stepStats: StepConversionStats;
}
