/**
 * xm_save - TypeScript library for creating XM (Extended Module) files
 * 
 * This library allows you to create .xm files from sample data and pattern data.
 * The XM file format is used by FastTracker II and other music tracker software.
 * 
 * @example
 * ```typescript
 * import { createModule, createPattern, createInstrument, createSample, addSampleToInstrument, XMWriter } from 'xm_save';
 * 
 * // Create a new module
 * const module = createModule({ moduleName: 'My Song', numberOfChannels: 4 });
 * 
 * // Create and add a pattern
 * const pattern = createPattern(64, 4);
 * pattern.data[0][0].note = 37; // C-3
 * pattern.data[0][0].instrument = 1;
 * module.patterns.push(pattern);
 * module.header.numberOfPatterns = 1;
 * 
 * // Create an instrument with a sample
 * const instrument = createInstrument('Sine Wave');
 * const sampleData = new Int8Array(256);
 * for (let i = 0; i < 256; i++) {
 *   sampleData[i] = Math.round(Math.sin(i / 256 * Math.PI * 2) * 127);
 * }
 * const sample = createSample({ name: 'Sine', data: sampleData });
 * addSampleToInstrument(instrument, sample);
 * module.instruments.push(instrument);
 * module.header.numberOfInstruments = 1;
 * 
 * // Write to file
 * const writer = new XMWriter();
 * const buffer = writer.write(module);
 * ```
 */

// Export types
export {
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
