/**
 * xm_save - TypeScript library for creating XM (Extended Module) files
 */

// Export types
export type {
  XMHeader,
  XMPattern,
  XMPatternHeader,
  XMPatternNote,
  XMInstrument,
  XMInstrumentHeader,
  XMInstrumentExtendedHeader,
  XMSample,
  XMSampleHeader,
  XMEnvelope,
  XMEnvelopePoint,
  XMModule,
} from './types';

export {
  XM_CONSTANTS,
  LoopType,
  EnvelopeFlags,
  XMEffects,
} from './types';

// Export writer and helper functions
export {
  XMWriter,
  createModule,
  createPattern,
  createInstrument,
  createSample,
  createEmptyEnvelope,
  addSampleToInstrument,
  noteNameToValue,
  noteValueToName,
  saveToFile,
} from './xmWriter';

// Export binary writer for advanced use cases
export { BinaryWriter } from './binaryWriter';
