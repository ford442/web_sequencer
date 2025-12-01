/**
 * XM (Extended Module) file format types and interfaces
 * Based on the FastTracker II XM file format specification
 */

/**
 * XM file header structure
 */
export interface XMHeader {
  /** Module name (up to 20 characters) */
  moduleName: string;
  /** Tracker name (up to 20 characters) */
  trackerName: string;
  /** Version number (usually 0x0104) */
  version: number;
  /** Song length in patterns (1-256) */
  songLength: number;
  /** Restart position (0-255) */
  restartPosition: number;
  /** Number of channels (2-32) */
  numberOfChannels: number;
  /** Number of patterns (1-256) */
  numberOfPatterns: number;
  /** Number of instruments (0-128) */
  numberOfInstruments: number;
  /** Flags: bit 0: 0 = Amiga frequency table, 1 = Linear frequency table */
  flags: number;
  /** Default tempo (1-31) */
  defaultTempo: number;
  /** Default BPM (32-255) */
  defaultBPM: number;
  /** Pattern order table (256 bytes) */
  patternOrderTable: number[];
}

/**
 * XM pattern note entry
 */
export interface XMPatternNote {
  /** Note value (0 = no note, 1-96 = C-0 to B-7, 97 = note off) */
  note: number;
  /** Instrument number (0 = no instrument change) */
  instrument: number;
  /**
   * [OPTIONAL] Set volume command (0-64, maps to XM bytes 0x10-0x50).
   * undefined means "No Change" (0x00 in XM).
   */
  volume?: number;
  /**
   * [OPTIONAL] Raw volume column effect command (0x60-0xFF).
   * Cannot be used if 'volume' is set.
   */
  volumeEffect?: number;
  /** Effect type (0-35) */
  effectType: number;
  /** Effect parameter */
  effectParam: number;
}

/**
 * XM pattern header structure
 */
export interface XMPatternHeader {
  /** Header length */
  headerLength: number;
  /** Packing type (always 0) */
  packingType: number;
  /** Number of rows in pattern (1-256) */
  numberOfRows: number;
  /** Packed pattern data size */
  packedDataSize: number;
}

/**
 * XM pattern structure
 */
export interface XMPattern {
  /** Pattern header */
  header: XMPatternHeader;
  /** Pattern data - 2D array [row][channel] */
  data: XMPatternNote[][];
}

/**
 * XM envelope point
 */
export interface XMEnvelopePoint {
  /** X position (frame number) */
  x: number;
  /** Y value (0-64) */
  y: number;
}

/**
 * XM envelope structure
 */
export interface XMEnvelope {
  /** Envelope points (up to 12) */
  points: XMEnvelopePoint[];
  /** Number of points */
  numberOfPoints: number;
  /** Sustain point */
  sustainPoint: number;
  /** Loop start point */
  loopStartPoint: number;
  /** Loop end point */
  loopEndPoint: number;
  /** Envelope type flags: bit 0 = on, bit 1 = sustain, bit 2 = loop */
  type: number;
}

/**
 * XM sample header structure
 */
export interface XMSampleHeader {
  /** Sample length in bytes */
  length: number;
  /** Sample loop start */
  loopStart: number;
  /** Sample loop length */
  loopLength: number;
  /** Volume (0-64) */
  volume: number;
  /** Fine tune (-128 to +127) */
  fineTune: number;
  /** Type flags: bit 0-1 = loop type (0=none, 1=forward, 2=ping-pong), bit 4 = 16-bit samples */
  type: number;
  /** Panning (0-255) */
  panning: number;
  /** Relative note number (-128 to +127) */
  relativeNoteNumber: number;
  /** Reserved byte */
  reserved: number;
  /** Sample name (up to 22 characters) */
  name: string;
}

/**
 * XM sample structure
 */
export interface XMSample {
  /** Sample header */
  header: XMSampleHeader;
  /** Sample data (8-bit or 16-bit PCM, delta encoded) */
  data: Int8Array | Int16Array;
}

/**
 * XM instrument header structure
 */
export interface XMInstrumentHeader {
  /** Instrument header size */
  headerSize: number;
  /** Instrument name (up to 22 characters) */
  name: string;
  /** Instrument type (always 0) */
  type: number;
  /** Number of samples */
  numberOfSamples: number;
}

/**
 * XM instrument extended header (present when numberOfSamples > 0)
 */
export interface XMInstrumentExtendedHeader {
  /** Sample header size */
  sampleHeaderSize: number;
  /** Sample number for all notes (96 bytes) */
  sampleNumberForNotes: number[];
  /** Volume envelope */
  volumeEnvelope: XMEnvelope;
  /** Panning envelope */
  panningEnvelope: XMEnvelope;
  /** Vibrato type */
  vibratoType: number;
  /** Vibrato sweep */
  vibratoSweep: number;
  /** Vibrato depth */
  vibratoDepth: number;
  /** Vibrato rate */
  vibratoRate: number;
  /** Volume fade out */
  volumeFadeOut: number;
}

/**
 * XM instrument structure
 */
export interface XMInstrument {
  /** Instrument header */
  header: XMInstrumentHeader;
  /** Extended header (only present if numberOfSamples > 0) */
  extendedHeader?: XMInstrumentExtendedHeader;
  /** Samples */
  samples: XMSample[];
}

/**
 * Complete XM module structure
 */
export interface XMModule {
  /** XM header */
  header: XMHeader;
  /** Patterns */
  patterns: XMPattern[];
  /** Instruments */
  instruments: XMInstrument[];
}

/**
 * XM file format constants
 */
export const XM_CONSTANTS = {
  /** XM ID string */
  ID_STRING: 'Extended Module: ',
  /** XM ID byte (0x1A) */
  ID_BYTE: 0x1a,
  /** Header size (not including ID string and module name) */
  HEADER_SIZE: 276,
  /** Pattern header size */
  PATTERN_HEADER_SIZE: 9,
  /** Instrument header size */
  INSTRUMENT_HEADER_SIZE: 29,
  /** Extended instrument header size */
  EXTENDED_INSTRUMENT_HEADER_SIZE: 214,
  /** Sample header size */
  SAMPLE_HEADER_SIZE: 40,
  /** Maximum module name length */
  MAX_MODULE_NAME_LENGTH: 20,
  /** Maximum tracker name length */
  MAX_TRACKER_NAME_LENGTH: 20,
  /** Maximum instrument name length */
  MAX_INSTRUMENT_NAME_LENGTH: 22,
  /** Maximum sample name length */
  MAX_SAMPLE_NAME_LENGTH: 22,
  /** Pattern order table size */
  PATTERN_ORDER_TABLE_SIZE: 256,
  /** Maximum number of envelope points */
  MAX_ENVELOPE_POINTS: 12,
  /** Sample number for notes array size */
  SAMPLE_NUMBER_FOR_NOTES_SIZE: 96,
  /** Default XM version */
  DEFAULT_VERSION: 0x0104,
  /** Default tracker name */
  DEFAULT_TRACKER_NAME: 'xm_save TypeScript ',
  /** Note off value */
  NOTE_OFF: 97,
  /** Linear frequency table flag */
  FLAG_LINEAR_FREQUENCY: 0x01,
} as const;

/**
 * Loop type enum
 */
export enum LoopType {
  None = 0,
  Forward = 1,
  PingPong = 2,
}

/**
 * Envelope type flags
 */
export enum EnvelopeFlags {
  On = 0x01,
  Sustain = 0x02,
  Loop = 0x04,
}

/**
 * Main XM Effects (E-Type, Effect Type 0-35)
 */
export enum XMEffects {
  Arpeggio = 0x0, // 0-9
  PortamentoUp = 0x1,
  PortamentoDown = 0x2,
  TonePortamento = 0x3,
  Vibrato = 0x4,
  TonePortaVolumeSlide = 0x5,
  VibratoVolumeSlide = 0x6,
  Tremolo = 0x7,
  SetPanning = 0x8,
  SetSampleOffset = 0x9, // Parameter in 256-byte units
  VolumeSlide = 0xA,
  PositionJump = 0xB,
  SetVolume = 0xC, // Sets the main volume column value
  PatternBreak = 0xD,
  ExtendedEffect = 0xE, // E-type effects (E0-EF)
  SetGlobalVolume = 0xF,
  // Effect type 10+
  SetTempoBPM = 0x11, // G
  FineVibrato = 0x12, // H
  SetGlobalVolumeSlide = 0x14, // K
  SetEnvelopePosition = 0x15, // L
  MultiRetriggerNote = 0x1D, // T
}
