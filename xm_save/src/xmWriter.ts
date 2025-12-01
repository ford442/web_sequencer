/**
 * XM (Extended Module) file writer
 * Creates .xm files from sample and pattern data
 */

import { BinaryWriter } from './binaryWriter';
import {
  XMModule,
  XMHeader,
  XMPattern,
  XMPatternNote,
  XMInstrument,
  XMSample,
  XMEnvelope,
  XM_CONSTANTS,
} from './types';

/**
 * XM file writer class
 */
export class XMWriter {
  private writer: BinaryWriter;

  constructor() {
    this.writer = new BinaryWriter();
  }

  /**
   * Write a complete XM module to binary format
   * @param module The XM module to write
   * @returns ArrayBuffer containing the XM file data
   */
  write(module: XMModule): ArrayBuffer {
    // Validate limits
    if (module.header.numberOfChannels > 32) {
      throw new Error('Number of channels cannot exceed 32');
    }
    if (module.header.numberOfInstruments > 128) {
      throw new Error('Number of instruments cannot exceed 128');
    }
    if (module.header.numberOfPatterns > 256) {
      throw new Error('Number of patterns cannot exceed 256');
    }

    this.writer = new BinaryWriter();

    this.writeHeader(module.header);
    this.writePatterns(module.patterns, module.header.numberOfChannels);
    this.writeInstruments(module.instruments);

    return this.writer.getBuffer();
  }

  /**
   * Write the XM header
   * @param header XM header structure
   */
  private writeHeader(header: XMHeader): void {
    // ID string "Extended Module: " (17 bytes)
    this.writer.writeString(XM_CONSTANTS.ID_STRING, 17);

    // Module name (20 bytes, padded with zeros)
    this.writer.writeString(header.moduleName, XM_CONSTANTS.MAX_MODULE_NAME_LENGTH);

    // 0x1A byte
    this.writer.writeUint8(XM_CONSTANTS.ID_BYTE);

    // Tracker name (20 bytes, padded with zeros)
    this.writer.writeString(header.trackerName, XM_CONSTANTS.MAX_TRACKER_NAME_LENGTH);

    // Version number (little-endian)
    this.writer.writeUint16(header.version);

    // Header size (starting from this point) - always 276 bytes
    this.writer.writeUint32(XM_CONSTANTS.HEADER_SIZE);

    // Song length
    this.writer.writeUint16(header.songLength);

    // Restart position
    this.writer.writeUint16(header.restartPosition);

    // Number of channels
    this.writer.writeUint16(header.numberOfChannels);

    // Number of patterns
    this.writer.writeUint16(header.numberOfPatterns);

    // Number of instruments
    this.writer.writeUint16(header.numberOfInstruments);

    // Flags
    this.writer.writeUint16(header.flags);

    // Default tempo
    this.writer.writeUint16(header.defaultTempo);

    // Default BPM
    this.writer.writeUint16(header.defaultBPM);

    // Pattern order table (256 bytes)
    for (let i = 0; i < XM_CONSTANTS.PATTERN_ORDER_TABLE_SIZE; i++) {
      this.writer.writeUint8(header.patternOrderTable[i] || 0);
    }
  }

  /**
   * Pack a pattern note into compressed format
   * @param note Pattern note to pack
   * @returns Packed bytes for this note
   */
  private packNote(note: XMPatternNote): Uint8Array {
    // Mutual exclusion check for volume
    if (note.volume !== undefined && note.volumeEffect !== undefined) {
      throw new Error('Cannot set both volume and volumeEffect on the same note');
    }

    let volumeByte = 0;
    if (note.volumeEffect !== undefined) {
      volumeByte = note.volumeEffect;
    } else if (note.volume !== undefined) {
      // Map 0-64 to 0x10-0x50
      // 0x10 = Volume 0 (Silence)
      // 0x50 = Volume 64 (Max)
      volumeByte = note.volume + 0x10;
    }

    // Check if all fields are empty
    const hasNote = note.note !== 0;
    const hasInstrument = note.instrument !== 0;
    const hasVolume = volumeByte !== 0;
    const hasEffect = note.effectType !== 0 || note.effectParam !== 0;

    // If all fields are present, write them all without packing
    if (hasNote && hasInstrument && hasVolume && hasEffect) {
      return new Uint8Array([
        note.note,
        note.instrument,
        volumeByte,
        note.effectType,
        note.effectParam,
      ]);
    }

    // Use packed format
    let flags = 0x80; // Bit 7 set = packed format
    const bytes: number[] = [];

    if (hasNote) {
      flags |= 0x01;
      bytes.push(note.note);
    }
    if (hasInstrument) {
      flags |= 0x02;
      bytes.push(note.instrument);
    }
    if (hasVolume) {
      flags |= 0x04;
      bytes.push(volumeByte);
    }
    if (note.effectType !== 0) {
      flags |= 0x08;
      bytes.push(note.effectType);
    }
    if (note.effectParam !== 0 || note.effectType !== 0) {
      flags |= 0x10;
      bytes.push(note.effectParam);
    }

    return new Uint8Array([flags, ...bytes]);
  }

  /**
   * Write all patterns
   * @param patterns Array of patterns
   * @param numberOfChannels Number of channels
   */
  private writePatterns(patterns: XMPattern[], numberOfChannels: number): void {
    for (const pattern of patterns) {
      this.writePattern(pattern, numberOfChannels);
    }
  }

  /**
   * Write a single pattern
   * @param pattern Pattern to write
   * @param numberOfChannels Number of channels
   */
  private writePattern(pattern: XMPattern, numberOfChannels: number): void {
    // Pattern header length (always 9)
    this.writer.writeUint32(XM_CONSTANTS.PATTERN_HEADER_SIZE);

    // Packing type (always 0)
    this.writer.writeUint8(0);

    // Number of rows
    this.writer.writeUint16(pattern.header.numberOfRows);

    // We need to write the packed data size, but we don't know it yet
    // Save the position to write it later
    const packedSizePosition = this.writer.getPosition();
    this.writer.writeUint16(0); // Placeholder

    const dataStartPosition = this.writer.getPosition();

    // Pack and write pattern data
    for (let row = 0; row < pattern.header.numberOfRows; row++) {
      for (let channel = 0; channel < numberOfChannels; channel++) {
        const note = pattern.data[row]?.[channel] || {
          note: 0,
          instrument: 0,
          volume: 0,
          effectType: 0,
          effectParam: 0,
        };
        const packedNote = this.packNote(note);
        this.writer.writeBytes(packedNote);
      }
    }

    // Calculate and write the packed data size
    const packedSize = this.writer.getPosition() - dataStartPosition;
    this.writer.writeUint16At(packedSizePosition, packedSize);
  }

  /**
   * Write all instruments
   * @param instruments Array of instruments
   */
  private writeInstruments(instruments: XMInstrument[]): void {
    for (const instrument of instruments) {
      this.writeInstrument(instrument);
    }
  }

  /**
   * Write a single instrument
   * @param instrument Instrument to write
   */
  private writeInstrument(instrument: XMInstrument): void {
    const hasSamples = instrument.samples.length > 0;
    const headerSize = hasSamples
      ? XM_CONSTANTS.INSTRUMENT_HEADER_SIZE + XM_CONSTANTS.EXTENDED_INSTRUMENT_HEADER_SIZE
      : XM_CONSTANTS.INSTRUMENT_HEADER_SIZE;

    // Instrument header size
    this.writer.writeUint32(headerSize);

    // Instrument name (22 bytes)
    this.writer.writeString(instrument.header.name, XM_CONSTANTS.MAX_INSTRUMENT_NAME_LENGTH);

    // Instrument type (always 0)
    this.writer.writeUint8(0);

    // Number of samples
    this.writer.writeUint16(instrument.samples.length);

    // Extended header (only if samples exist)
    if (hasSamples && instrument.extendedHeader) {
      // Sample header size
      this.writer.writeUint32(XM_CONSTANTS.SAMPLE_HEADER_SIZE);

      // Sample number for all notes (96 bytes)
      for (let i = 0; i < XM_CONSTANTS.SAMPLE_NUMBER_FOR_NOTES_SIZE; i++) {
        this.writer.writeUint8(instrument.extendedHeader.sampleNumberForNotes[i] || 0);
      }

      // Volume envelope points (24 bytes: 12 points * 2 bytes each for x and y)
      this.writeEnvelopePoints(instrument.extendedHeader.volumeEnvelope);

      // Panning envelope points (24 bytes)
      this.writeEnvelopePoints(instrument.extendedHeader.panningEnvelope);

      // Volume envelope number of points
      this.writer.writeUint8(instrument.extendedHeader.volumeEnvelope.numberOfPoints);

      // Panning envelope number of points
      this.writer.writeUint8(instrument.extendedHeader.panningEnvelope.numberOfPoints);

      // Volume envelope sustain point
      this.writer.writeUint8(instrument.extendedHeader.volumeEnvelope.sustainPoint);

      // Volume envelope loop start
      this.writer.writeUint8(instrument.extendedHeader.volumeEnvelope.loopStartPoint);

      // Volume envelope loop end
      this.writer.writeUint8(instrument.extendedHeader.volumeEnvelope.loopEndPoint);

      // Panning envelope sustain point
      this.writer.writeUint8(instrument.extendedHeader.panningEnvelope.sustainPoint);

      // Panning envelope loop start
      this.writer.writeUint8(instrument.extendedHeader.panningEnvelope.loopStartPoint);

      // Panning envelope loop end
      this.writer.writeUint8(instrument.extendedHeader.panningEnvelope.loopEndPoint);

      // Volume envelope type
      this.writer.writeUint8(instrument.extendedHeader.volumeEnvelope.type);

      // Panning envelope type
      this.writer.writeUint8(instrument.extendedHeader.panningEnvelope.type);

      // Vibrato type
      this.writer.writeUint8(instrument.extendedHeader.vibratoType);

      // Vibrato sweep
      this.writer.writeUint8(instrument.extendedHeader.vibratoSweep);

      // Vibrato depth
      this.writer.writeUint8(instrument.extendedHeader.vibratoDepth);

      // Vibrato rate
      this.writer.writeUint8(instrument.extendedHeader.vibratoRate);

      // Volume fade out
      this.writer.writeUint16(instrument.extendedHeader.volumeFadeOut);

      // Reserved (2 bytes)
      this.writer.writeUint16(0);

      // Write sample headers
      for (const sample of instrument.samples) {
        this.writeSampleHeader(sample);
      }

      // Write sample data
      for (const sample of instrument.samples) {
        this.writeSampleData(sample);
      }
    }
  }

  /**
   * Write envelope points
   * @param envelope Envelope structure
   */
  private writeEnvelopePoints(envelope: XMEnvelope): void {
    // Write 12 points (24 bytes total)
    for (let i = 0; i < XM_CONSTANTS.MAX_ENVELOPE_POINTS; i++) {
      const point = envelope.points[i] || { x: 0, y: 0 };
      this.writer.writeUint16(point.x);
      this.writer.writeUint16(point.y);
    }
  }

  /**
   * Write sample header
   * @param sample Sample to write header for
   */
  private writeSampleHeader(sample: XMSample): void {
    const is16Bit = (sample.header.type & 0x10) !== 0;
    const sampleLength = is16Bit ? sample.data.length * 2 : sample.data.length;
    const loopStart = is16Bit ? sample.header.loopStart * 2 : sample.header.loopStart;
    const loopLength = is16Bit ? sample.header.loopLength * 2 : sample.header.loopLength;

    // Sample length
    this.writer.writeUint32(sampleLength);

    // Sample loop start
    this.writer.writeUint32(loopStart);

    // Sample loop length
    this.writer.writeUint32(loopLength);

    // Volume
    this.writer.writeUint8(sample.header.volume);

    // Fine tune
    this.writer.writeInt8(sample.header.fineTune);

    // Type
    this.writer.writeUint8(sample.header.type);

    // Panning
    this.writer.writeUint8(sample.header.panning);

    // Relative note number
    this.writer.writeInt8(sample.header.relativeNoteNumber);

    // Reserved
    this.writer.writeUint8(sample.header.reserved);

    // Sample name (22 bytes)
    this.writer.writeString(sample.header.name, XM_CONSTANTS.MAX_SAMPLE_NAME_LENGTH);
  }

  /**
   * Write sample data (delta encoded)
   * @param sample Sample to write data for
   */
  private writeSampleData(sample: XMSample): void {
    const is16Bit = (sample.header.type & 0x10) !== 0;
    
    if (is16Bit) {
      // 16-bit sample data (delta encoded)
      let lastValue = 0;
      for (let i = 0; i < sample.data.length; i++) {
        const value = sample.data[i];
        const delta = value - lastValue;
        this.writer.writeInt16(delta);
        lastValue = value;
      }
    } else {
      // 8-bit sample data (delta encoded)
      let lastValue = 0;
      for (let i = 0; i < sample.data.length; i++) {
        const value = sample.data[i];
        const delta = value - lastValue;
        this.writer.writeInt8(delta);
        lastValue = value;
      }
    }
  }
}

/**
 * Create a simple XM module with default settings
 * @param options Module creation options
 * @returns A new XM module structure
 */
export function createModule(options: {
  moduleName?: string;
  numberOfChannels?: number;
  defaultTempo?: number;
  defaultBPM?: number;
}): XMModule {
  const numberOfChannels = options.numberOfChannels || 4;
  
  return {
    header: {
      moduleName: options.moduleName || 'Untitled',
      trackerName: XM_CONSTANTS.DEFAULT_TRACKER_NAME,
      version: XM_CONSTANTS.DEFAULT_VERSION,
      songLength: 1,
      restartPosition: 0,
      numberOfChannels,
      numberOfPatterns: 1,
      numberOfInstruments: 0,
      flags: XM_CONSTANTS.FLAG_LINEAR_FREQUENCY,
      defaultTempo: options.defaultTempo || 6,
      defaultBPM: options.defaultBPM || 125,
      patternOrderTable: new Array(XM_CONSTANTS.PATTERN_ORDER_TABLE_SIZE).fill(0),
    },
    patterns: [],
    instruments: [],
  };
}

/**
 * Create an empty pattern
 * @param numberOfRows Number of rows in the pattern (default 64)
 * @param numberOfChannels Number of channels
 * @returns A new empty pattern
 */
export function createPattern(numberOfRows: number = 64, numberOfChannels: number = 4): XMPattern {
  const data: XMPatternNote[][] = [];
  
  for (let row = 0; row < numberOfRows; row++) {
    const rowData: XMPatternNote[] = [];
    for (let channel = 0; channel < numberOfChannels; channel++) {
      rowData.push({
        note: 0,
        instrument: 0,
        // volume is undefined by default
        effectType: 0,
        effectParam: 0,
      });
    }
    data.push(rowData);
  }

  return {
    header: {
      headerLength: XM_CONSTANTS.PATTERN_HEADER_SIZE,
      packingType: 0,
      numberOfRows,
      packedDataSize: 0, // Will be calculated during write
    },
    data,
  };
}

/**
 * Create an empty instrument
 * @param name Instrument name
 * @returns A new empty instrument structure
 */
export function createInstrument(name: string = 'Instrument'): XMInstrument {
  return {
    header: {
      headerSize: XM_CONSTANTS.INSTRUMENT_HEADER_SIZE,
      name,
      type: 0,
      numberOfSamples: 0,
    },
    samples: [],
  };
}

/**
 * Create an empty envelope
 * @returns A new empty envelope structure
 */
export function createEmptyEnvelope(): XMEnvelope {
  return {
    points: [],
    numberOfPoints: 0,
    sustainPoint: 0,
    loopStartPoint: 0,
    loopEndPoint: 0,
    type: 0,
  };
}

/**
 * Create a sample from PCM data
 * @param options Sample creation options
 * @returns A new sample structure
 */
export function createSample(options: {
  name?: string;
  data: Int8Array | Int16Array;
  volume?: number;
  fineTune?: number;
  loopStart?: number;
  loopLength?: number;
  loopType?: number;
  panning?: number;
  relativeNoteNumber?: number;
}): XMSample {
  const is16Bit = options.data instanceof Int16Array;
  const loopType = options.loopType || 0;
  
  return {
    header: {
      length: is16Bit ? options.data.length * 2 : options.data.length,
      loopStart: options.loopStart || 0,
      loopLength: options.loopLength || 0,
      volume: options.volume ?? 64,
      fineTune: options.fineTune || 0,
      type: (loopType & 0x03) | (is16Bit ? 0x10 : 0),
      panning: options.panning ?? 128,
      relativeNoteNumber: options.relativeNoteNumber || 0,
      reserved: 0,
      name: options.name || 'Sample',
    },
    data: options.data,
  };
}

/**
 * Add a sample to an instrument
 * @param instrument The instrument to add the sample to
 * @param sample The sample to add
 */
export function addSampleToInstrument(instrument: XMInstrument, sample: XMSample): void {
  // Initialize extended header if this is the first sample
  if (instrument.samples.length === 0) {
    instrument.extendedHeader = {
      sampleHeaderSize: XM_CONSTANTS.SAMPLE_HEADER_SIZE,
      sampleNumberForNotes: new Array(XM_CONSTANTS.SAMPLE_NUMBER_FOR_NOTES_SIZE).fill(0),
      volumeEnvelope: createEmptyEnvelope(),
      panningEnvelope: createEmptyEnvelope(),
      vibratoType: 0,
      vibratoSweep: 0,
      vibratoDepth: 0,
      vibratoRate: 0,
      volumeFadeOut: 0,
    };
  }

  instrument.samples.push(sample);
  instrument.header.numberOfSamples = instrument.samples.length;
}

/**
 * Convert note name to XM note value
 * @param noteName Note name (e.g., "C-4", "A#3")
 * @returns XM note value (1-96) or 0 if invalid
 */
export function noteNameToValue(noteName: string): number {
  const noteNames = ['C-', 'C#', 'D-', 'D#', 'E-', 'F-', 'F#', 'G-', 'G#', 'A-', 'A#', 'B-'];
  const match = noteName.match(/^([A-Ga-g][#-]?)(\d)$/);
  
  if (!match) return 0;
  
  let note = match[1].toUpperCase();
  // Normalize note name
  if (note.length === 1 || (note.length === 2 && note[1] === '-')) {
    note = note[0] + '-';
  }
  
  const octave = parseInt(match[2], 10);
  const noteIndex = noteNames.indexOf(note);
  
  if (noteIndex === -1 || octave < 0 || octave > 7) return 0;
  
  return octave * 12 + noteIndex + 1;
}

/**
 * Convert XM note value to note name
 * @param noteValue XM note value (1-96)
 * @returns Note name (e.g., "C-4")
 */
export function noteValueToName(noteValue: number): string {
  if (noteValue === 0) return '---';
  if (noteValue === XM_CONSTANTS.NOTE_OFF) return 'OFF';
  if (noteValue < 1 || noteValue > 96) return '???';
  
  const noteNames = ['C-', 'C#', 'D-', 'D#', 'E-', 'F-', 'F#', 'G-', 'G#', 'A-', 'A#', 'B-'];
  const note = (noteValue - 1) % 12;
  const octave = Math.floor((noteValue - 1) / 12);
  
  return noteNames[note] + octave;
}

/**
 * Save an XM module to a file (Node.js only)
 * @param module The XM module to save
 * @param filename The output filename
 */
export async function saveToFile(module: XMModule, filename: string): Promise<void> {
  const writer = new XMWriter();
  const buffer = writer.write(module);
  
  // Dynamic import for Node.js fs module
  const { promises: fs } = await import('fs');
  await fs.writeFile(filename, Buffer.from(buffer));
}
