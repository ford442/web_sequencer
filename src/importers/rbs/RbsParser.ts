import type {
  RawRbsData, RbsGlobData, RbsTrakEvent, RbsTrakData, RbsSongData, RbsProject,
  Tb303PatternA, Tb303PatternB, DrumPattern, PcfSettings, AutomationLane, HyphonAutomationLane,
  Tb303Step, RbsBinaryHeader, RbsRawStep, RbsRawAutomationPoint, RbsRawAutomationLane
} from './types';
import { DEFAULT_RBS_IMPORT_OPTIONS, AUTOMATION_PARAMETER_MAP, TRAK_CONTROLLER } from './types';
import type { RbsParserResult, RbsParserError, IffChunk } from './parser-types';
import { MIN_FILE_SIZE, OFFSETS, STEP_COUNT, STEP_SIZE, NOTE_REST, NOTE_TIE, MAX_TRAK_EVENTS, SUPPORTED_VERSIONS } from './parser-types';
import { TICKS_PER_BAR } from './types';

export class RbsParser {
  /** Parse progress callback (0-100) */
  onProgress?: (percent: number) => void;

  private dataView!: DataView;
  private rawBytes!: Uint8Array;
  private fileSize!: number;

  /**
   * Parse raw bytes (test / programmatic entry point).
   * Never throws — all failures are returned as `{ success: false, error }`.
   */
  async parseBytes(
    bytes: Uint8Array,
    options: { filename?: string; requireExtension?: boolean } = {}
  ): Promise<RbsParserResult> {
    const filename = options.filename ?? 'input.rbs';
    const requireExtension = options.requireExtension ?? true;

    this.onProgress?.(0);

    try {
      if (requireExtension && !filename.toLowerCase().endsWith('.rbs')) {
        return {
          success: false,
          error: {
            type: 'INVALID_FORMAT',
            message: `File "${filename}" does not have .rbs extension`,
          },
        };
      }

      this.fileSize = bytes.byteLength;
      if (this.fileSize < MIN_FILE_SIZE) {
        return {
          success: false,
          error: {
            type: 'CORRUPTED_DATA',
            section: 'header',
            details: `File too small (${this.fileSize} bytes, min ${MIN_FILE_SIZE})`,
          },
        };
      }

      if (this.fileSize > 10 * 1024 * 1024) {
        return {
          success: false,
          error: {
            type: 'INVALID_FORMAT',
            message: 'File too large (max 10MB for RBS files)',
          },
        };
      }

      const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      this.dataView = new DataView(arrayBuffer);
      this.rawBytes = new Uint8Array(arrayBuffer);

      this.onProgress?.(5);

      const iffChunks = this.parseIffChunks();
      if (iffChunks.length > 0) {
        const truncationError = this.detectIffTruncation(iffChunks);
        if (truncationError) {
          return { success: false, error: truncationError };
        }

        console.info(`[RbsParser] Detected full IFF CAT RB40 structure with ${iffChunks.length} top-level chunks. Attempting full song parse.`);
        const iffResult = this.parseIffSongData(iffChunks);
        if (iffResult) {
          this.onProgress?.(100);
          return { success: true, data: iffResult };
        }
        console.info('[RbsParser] IFF song data incomplete, falling back to legacy single-pattern extraction.');
      }

      const headerResult = this.parseHeader();
      if (!headerResult.success) {
        return { success: false, error: (headerResult as { success: false; error: RbsParserError }).error };
      }
      const header = headerResult.data;
      this.onProgress?.(10);

      const tb303A = this.parseTb303PatternA();
      this.onProgress?.(40);

      const tb303B = this.parseTb303PatternB();
      this.onProgress?.(70);

      const drums = this.parseDrumPatterns();
      this.onProgress?.(85);

      const pcf = this.parsePcfSettings();
      this.onProgress?.(95);

      const automation = this.parseAutomation();
      this.onProgress?.(100);

      const baseName = filename.replace(/\.rbs$/i, '');

      const rawData: RawRbsData = {
        version: header.version,
        project: {
          name: header.songName || baseName,
          author: 'Imported from RBS',
          tempo: header.tempo,
          timeSignatureNum: header.timeSignatureNum,
          timeSignatureDen: header.timeSignatureDen,
          swing: header.swing,
          patternLength: header.patternLength,
          createdAt: new Date(),
          sourceSoftware: 'ReBirth RB-338',
        },
        tb303PatternA: tb303A,
        tb303PatternB: tb303B,
        drums,
        pcf,
        automation,
        rawHeader: header,
      };

      return { success: true, data: rawData };
    } catch (error) {
      return {
        success: false,
        error: {
          type: 'READ_ERROR',
          message: error instanceof Error ? error.message : 'Unknown error reading file',
        },
      };
    }
  }

  /**
   * Main entry point: parse an .rbs file
   */
  async parseRbsFile(file: File): Promise<RbsParserResult> {
    const arrayBuffer = await file.arrayBuffer();
    return this.parseBytes(new Uint8Array(arrayBuffer), { filename: file.name, requireExtension: true });
  }

  /**
   * Parse RBS file header (64 bytes at offset 0x00)
   */
  private parseHeader(): { success: true; data: RbsBinaryHeader } | { success: false; error: RbsParserError } {
    try {
      // Validate magic bytes "RB338" at offset 0x00
      const magicBytes = new Uint8Array(this.rawBytes.buffer, OFFSETS.HEADER, 5);
      const magic = String.fromCharCode(...magicBytes);
      
      if (magic !== 'RB338') {
        // Try alternative: check if first 5 bytes match
        const altMagic = this.readAsciiString(OFFSETS.HEADER, 5);
        if (altMagic !== 'RB338') {
          return {
            success: false,
            error: {
              type: 'INVALID_FORMAT',
              message: `Invalid magic bytes: expected "RB338", got "${magic}" (hex: ${Array.from(magicBytes).map(b => b.toString(16).padStart(2, '0')).join(' ')})`
            }
          };
        }
      }

      // Read version (offset 0x08: major, 0x09: minor)
      const versionMajor = this.rawBytes[OFFSETS.HEADER + 0x08];
      const versionMinor = this.rawBytes[OFFSETS.HEADER + 0x09];
      const version = `${versionMajor}.${versionMinor}`;

      // Read pattern length (offset 0x0A)
      const patternLength = this.rawBytes[OFFSETS.HEADER + 0x0A];
      if (patternLength !== 16 && patternLength !== 32) {
        // Non-standard pattern length, but we'll accept it
        console.warn(`[RbsParser] Non-standard pattern length: ${patternLength}`);
      }

      // Read tempo (offset 0x0B, 40-250 BPM)
      const tempo = this.rawBytes[OFFSETS.HEADER + 0x0B];
      if (tempo < 40 || tempo > 250) {
        console.warn(`[RbsParser] Unusual tempo value: ${tempo}`);
      }

      // Read time signature (offset 0x0C: num, 0x0D: den)
      const timeSignatureNum = this.rawBytes[OFFSETS.HEADER + 0x0C] || 4;
      const timeSignatureDen = this.rawBytes[OFFSETS.HEADER + 0x0D] || 4;

      // Read swing (offset 0x0E, 0-100)
      const swing = this.rawBytes[OFFSETS.HEADER + 0x0E];

      // Read song name (offset 0x10-0x3F, 48 bytes, null-terminated ASCII)
      const songName = this.readNullTerminatedString(OFFSETS.HEADER + 0x10, 48);

      return {
        success: true,
        data: {
          magic,
          versionMajor,
          versionMinor,
          version,
          patternLength,
          tempo,
          timeSignatureNum,
          timeSignatureDen,
          swing,
          songName
        }
      };
    } catch (error) {
      return {
        success: false,
        error: {
          type: 'CORRUPTED_DATA',
          section: 'header',
          details: error instanceof Error ? error.message : 'Unknown header parse error',
          offset: 0
        }
      };
    }
  }

  /**
   * Parse TB-303 Pattern A (256 bytes at offset 0x40)
   */
  private parseTb303PatternA(): Tb303PatternA {
    const baseOffset = OFFSETS.TB303_A;
    
    // Read synthesizer parameters
    const cutoff = this.rawBytes[baseOffset + 0x00];
    const resonance = this.rawBytes[baseOffset + 0x01];
    const envMod = this.rawBytes[baseOffset + 0x02];
    const decay = this.rawBytes[baseOffset + 0x03];
    const accent = this.rawBytes[baseOffset + 0x04];
    const waveform = this.rawBytes[baseOffset + 0x05] as 0 | 1;
    const distortion = this.rawBytes[baseOffset + 0x06];
    const delaySend = this.rawBytes[baseOffset + 0x07];

    // Parse 16 steps (each step is 15 bytes, starting at offset 0x08)
    const steps: Tb303PatternA['steps'] = [];
    const stepsStartOffset = baseOffset + 0x08;

    for (let i = 0; i < STEP_COUNT; i++) {
      const stepOffset = stepsStartOffset + (i * STEP_SIZE);
      const rawStep = this.parseRawStep(stepOffset);
      steps.push(this.convertRawStepToTb303Step(i, rawStep));
    }

    return {
      steps,
      cutoff: this.clamp(cutoff, 0, 127),
      resonance: this.clamp(resonance, 0, 127),
      envMod: this.clamp(envMod, 0, 127),
      decay: this.clamp(decay, 0, 127),
      accent: this.clamp(accent, 0, 127),
      waveform: waveform === 0 ? 0 : 1,
      distortion: this.clamp(distortion, 0, 127),
      delaySend: this.clamp(delaySend, 0, 127)
    };
  }

  /**
   * Parse TB-303 Pattern B (256 bytes at offset 0x140)
   */
  private parseTb303PatternB(): Tb303PatternB {
    const baseOffset = OFFSETS.TB303_B;
    
    // Read synthesizer parameters
    const cutoff = this.rawBytes[baseOffset + 0x00];
    const resonance = this.rawBytes[baseOffset + 0x01];
    const envMod = this.rawBytes[baseOffset + 0x02];
    const decay = this.rawBytes[baseOffset + 0x03];
    const accent = this.rawBytes[baseOffset + 0x04];
    const waveform = this.rawBytes[baseOffset + 0x05] as 0 | 1;
    const distortion = this.rawBytes[baseOffset + 0x06];
    const delaySend = this.rawBytes[baseOffset + 0x07];
    
    // Pattern B has transpose at offset 0x08 (signed byte, -12 to +12)
    const transposeRaw = this.rawBytes[baseOffset + 0x08];
    const transpose = this.convertSignedByte(transposeRaw);

    // Parse 16 steps (each step is 15 bytes, starting at offset 0x09)
    const steps: Tb303PatternB['steps'] = [];
    const stepsStartOffset = baseOffset + 0x09;

    for (let i = 0; i < STEP_COUNT; i++) {
      const stepOffset = stepsStartOffset + (i * STEP_SIZE);
      const rawStep = this.parseRawStep(stepOffset);
      steps.push(this.convertRawStepToTb303Step(i, rawStep));
    }

    return {
      steps,
      cutoff: this.clamp(cutoff, 0, 127),
      resonance: this.clamp(resonance, 0, 127),
      envMod: this.clamp(envMod, 0, 127),
      decay: this.clamp(decay, 0, 127),
      accent: this.clamp(accent, 0, 127),
      waveform: waveform === 0 ? 0 : 1,
      distortion: this.clamp(distortion, 0, 127),
      delaySend: this.clamp(delaySend, 0, 127),
      transpose: this.clamp(transpose, -12, 12)
    };
  }

  /**
   * Parse a raw step from binary
   */
  private parseRawStep(offset: number): RbsRawStep {
    const note = this.rawBytes[offset + 0];
    const octave = this.rawBytes[offset + 1];
    const flags = this.rawBytes[offset + 2];
    const gate = this.rawBytes[offset + 3];

    return {
      note,
      octave,
      flags,
      gate
    };
  }

  /**
   * Convert raw step data to Tb303Step
   */
  private convertRawStepToTb303Step(index: number, raw: RbsRawStep): Tb303PatternA['steps'][0] {
    // Note: 0-11 (C-B), 255=rest, 254=tie
    let note: number;
    let tie = false;
    
    if (raw.note === 255) {
      note = -1; // Rest
    } else if (raw.note === 254) {
      note = -1; // Tie (no new note)
      tie = true;
    } else {
      note = raw.note % 12; // Ensure 0-11 range
    }

    // Parse flags: bit0=accent, bit1=slide, bit2=tie
    const accent = (raw.flags & 0x01) !== 0;
    const slide = (raw.flags & 0x02) !== 0;
    const tieFlag = (raw.flags & 0x04) !== 0 || tie;

    return {
      index,
      note,
      octave: this.clamp(raw.octave, 1, 5),
      accent,
      slide,
      tie: tieFlag,
      gate: this.clamp(raw.gate, 0, 100)
    };
  }

  /**
   * Parse Drum patterns (128 bytes at offset 0x240)
   */
  private parseDrumPatterns(): DrumPattern {
    const baseOffset = OFFSETS.DRUMS;

    // Parse 16-step boolean patterns
    const kick: boolean[] = [];
    const snare: boolean[] = [];
    const closedHat: boolean[] = [];
    const openHat: boolean[] = [];
    const accent: number[] = [];

    for (let i = 0; i < STEP_COUNT; i++) {
      kick.push(this.rawBytes[baseOffset + i] !== 0);
      snare.push(this.rawBytes[baseOffset + 0x10 + i] !== 0);
      closedHat.push(this.rawBytes[baseOffset + 0x20 + i] !== 0);
      openHat.push(this.rawBytes[baseOffset + 0x30 + i] !== 0);
      accent.push(this.rawBytes[baseOffset + 0x40 + i]);
    }

    // Parse drum parameters (starting at offset 0x50 within drum section)
    const paramsOffset = baseOffset + 0x50;
    const kitTypeNum = this.rawBytes[paramsOffset + 0];
    const kitType: '808' | '909' = kitTypeNum === 0 ? '808' : '909';

    // Tuning values are offset by 50 (stored as 0-100, actual -50 to +50)
    const kickTune = this.convertSignedByteWithOffset(this.rawBytes[paramsOffset + 1], 50);
    const snareTune = this.convertSignedByteWithOffset(this.rawBytes[paramsOffset + 2], 50);
    const closedHatTune = this.convertSignedByteWithOffset(this.rawBytes[paramsOffset + 3], 50);
    const openHatTune = this.convertSignedByteWithOffset(this.rawBytes[paramsOffset + 4], 50);

    // Decay values (0-127)
    const kickDecay = this.rawBytes[paramsOffset + 5];
    const snareDecay = this.rawBytes[paramsOffset + 6];
    const closedHatDecay = this.rawBytes[paramsOffset + 7];
    const openHatDecay = this.rawBytes[paramsOffset + 8];

    return {
      kick,
      snare,
      closedHat,
      openHat,
      accent,
      kitType,
      tuning: {
        kick: this.clamp(kickTune, -50, 50),
        snare: this.clamp(snareTune, -50, 50),
        closedHat: this.clamp(closedHatTune, -50, 50),
        openHat: this.clamp(openHatTune, -50, 50)
      },
      decay: {
        kick: this.clamp(kickDecay, 0, 127),
        snare: this.clamp(snareDecay, 0, 127),
        closedHat: this.clamp(closedHatDecay, 0, 127),
        openHat: this.clamp(openHatDecay, 0, 127)
      }
    };
  }

  /**
   * Parse PCF (Pattern Controlled Filter) settings (64 bytes at offset 0x2C0)
   */
  private parsePcfSettings(): PcfSettings {
    const baseOffset = OFFSETS.PCF;

    const enabled = this.rawBytes[baseOffset + 0] !== 0;
    const filterTypeNum = this.rawBytes[baseOffset + 1];
    const cutoff = this.rawBytes[baseOffset + 2];
    const resonance = this.rawBytes[baseOffset + 3];
    const envAmount = this.rawBytes[baseOffset + 4];
    const decay = this.rawBytes[baseOffset + 5];
    const targetA = this.rawBytes[baseOffset + 6] !== 0;
    const targetB = this.rawBytes[baseOffset + 7] !== 0;
    const targetDrums = this.rawBytes[baseOffset + 8] !== 0;

    // Parse 16-step modulation pattern (starting at offset 9)
    const pattern: number[] = [];
    for (let i = 0; i < STEP_COUNT; i++) {
      pattern.push(this.rawBytes[baseOffset + 9 + i]);
    }

    // Map filter type number to string
    const filterTypeMap: Record<number, 'lp' | 'bp' | 'hp'> = {
      0: 'lp',
      1: 'bp',
      2: 'hp'
    };

    return {
      enabled,
      filterType: filterTypeMap[filterTypeNum] || 'lp',
      cutoff: this.clamp(cutoff, 0, 127),
      resonance: this.clamp(resonance, 0, 127),
      envAmount: this.clamp(envAmount, 0, 127),
      decay: this.clamp(decay, 0, 127),
      pattern: pattern.map(v => this.clamp(v, 0, 127)),
      target: {
        tb303A: targetA,
        tb303B: targetB,
        drums: targetDrums
      }
    };
  }

  /**
   * Parse Automation data (variable length at offset 0x300)
   */
  private parseAutomation(): AutomationLane[] {
    const baseOffset = OFFSETS.AUTOMATION;
    const lanes: AutomationLane[] = [];

    // Check if we have enough data for automation
    if (this.fileSize <= baseOffset) {
      return lanes;
    }

    try {
      const laneCount = this.rawBytes[baseOffset];
      let currentOffset = baseOffset + 1;

      for (let laneIdx = 0; laneIdx < laneCount; laneIdx++) {
        // Check bounds
        if (currentOffset + 2 > this.fileSize) {
          console.warn(`[RbsParser] Automation truncated at lane ${laneIdx}`);
          break;
        }

        const parameterId = this.rawBytes[currentOffset];
        const pointCount = this.rawBytes[currentOffset + 1];
        currentOffset += 2;

        // Parse points (3 bytes each: step + 2-byte value)
        const points: [number, number][] = [];
        for (let ptIdx = 0; ptIdx < pointCount; ptIdx++) {
          if (currentOffset + 3 > this.fileSize) {
            console.warn(`[RbsParser] Automation point ${ptIdx} truncated in lane ${laneIdx}`);
            break;
          }

          const step = this.rawBytes[currentOffset];
          const value = this.dataView.getUint16(currentOffset + 1, true); // Little-endian
          points.push([step, value]);
          currentOffset += 3;
        }

        // Map parameter ID to name
        const parameterName = AUTOMATION_PARAMETER_MAP[parameterId] || `param${parameterId}`;
        const displayName = this.getAutomationDisplayName(parameterName);
        const range = this.getAutomationRange(parameterName);

        lanes.push({
          parameter: parameterName as AutomationLane['parameter'],
          name: displayName,
          points,
          interpolation: 'linear',
          range
        });
      }
    } catch (error) {
      console.warn('[RbsParser] Error parsing automation:', error);
    }

    return lanes;
  }

  /**
   * Get display name for automation parameter
   */
  private getAutomationDisplayName(parameter: string): string {
    const names: Record<string, string> = {
      tempo: 'Tempo',
      swing: 'Swing',
      tb303Acutoff: 'TB-303 A Cutoff',
      tb303Bcutoff: 'TB-303 B Cutoff',
      pcfCutoff: 'PCF Cutoff',
      masterVolume: 'Master Volume',
      tb303Aresonance: 'TB-303 A Resonance',
      tb303Bresonance: 'TB-303 B Resonance',
      tb303Adecay: 'TB-303 A Decay',
      tb303Bdecay: 'TB-303 B Decay',
      pcfResonance: 'PCF Resonance',
      pcfEnvAmount: 'PCF Env Amount'
    };
    return names[parameter] || parameter;
  }

  /**
   * Get value range for automation parameter
   */
  private getAutomationRange(parameter: string): [number, number] {
    const ranges: Record<string, [number, number]> = {
      tempo: [40, 250],
      swing: [0, 100],
      tb303Acutoff: [0, 127],
      tb303Bcutoff: [0, 127],
      pcfCutoff: [0, 127],
      masterVolume: [0, 127],
      tb303Aresonance: [0, 127],
      tb303Bresonance: [0, 127],
      tb303Adecay: [0, 127],
      tb303Bdecay: [0, 127],
      pcfResonance: [0, 127],
      pcfEnvAmount: [0, 127]
    };
    return ranges[parameter] || [0, 127];
  }

  /**
   * Read null-terminated ASCII string
   */
  private readNullTerminatedString(offset: number, maxLength: number): string {
    let result = '';
    for (let i = 0; i < maxLength; i++) {
      const byte = this.rawBytes[offset + i];
      if (byte === 0) break; // Null terminator
      if (byte >= 32 && byte < 127) { // Printable ASCII
        result += String.fromCharCode(byte);
      }
    }
    return result.trim();
  }

  /**
   * Read fixed-length ASCII string
   */
  private readAsciiString(offset: number, length: number): string {
    let result = '';
    for (let i = 0; i < length; i++) {
      const byte = this.rawBytes[offset + i];
      if (byte >= 32 && byte < 127) {
        result += String.fromCharCode(byte);
      }
    }
    return result;
  }

  /**
   * Convert unsigned byte to signed (-128 to 127)
   */
  private convertSignedByte(value: number): number {
    return value > 127 ? value - 256 : value;
  }

  /**
   * Convert byte with offset (e.g., stored as 0-100, actual is -50 to +50)
   */
  private convertSignedByteWithOffset(value: number, offset: number): number {
    return this.convertSignedByte(value) - offset;
  }

  /**
   * Clamp value to range
   */
  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }

  /**
   * Detect IFF chunk payloads that extend past EOF (truncated file).
   */
  private detectIffTruncation(chunks: IffChunk[]): RbsParserError | null {
    for (const chunk of chunks) {
      const paddedSize = chunk.size + (chunk.size % 2);
      const end = chunk.offset + paddedSize;
      if (end > this.fileSize) {
        return {
          type: 'CORRUPTED_DATA',
          section: 'iff',
          details: `Truncated chunk "${chunk.id}" (payload ends at ${end}, file size ${this.fileSize})`,
          offset: chunk.offset,
        };
      }
    }
    return null;
  }

  /**
   * Parse top-level IFF CAT container and return list of chunks (for full RB40 song files).
   * This is the foundation for proper multi-pattern + song arrangement support (see #671).
   * ReBirth .rbs is "CAT <size> RB40" followed by chunks (HEAD, GLOB, DEVL catalog, TRKL catalog with TRAK events).
   * Sizes are big-endian. This method is intentionally lightweight and safe for progressive enhancement.
   */
  private parseIffChunks(): IffChunk[] {
    const chunks: IffChunk[] = [];
    if (this.fileSize < 12) return chunks;

    // Check for "CAT " magic at 0
    const magic = this.readAsciiString(0, 4);
    if (magic !== 'CAT ') {
      return chunks; // not IFF CAT; fall back to legacy fixed-offset path
    }

    // Root size (big-endian uint32 at 4)
    const rootSize = this.dataView.getUint32(4, false);
    let pos = 12; // after "CAT " + size + "RB40" (or similar form type)

    // Read form type (usually "RB40" or "RB40HEAD" style)
    const formType = this.readAsciiString(8, 4);
    console.debug(`[RbsParser] IFF CAT form detected: ${formType}, root size ${rootSize}`);

    // Walk chunks (simple safe parser; real impl will handle nested CAT DEVL/TRKL)
    const maxPos = Math.min(this.fileSize, 8 + rootSize);
    while (pos + 8 <= maxPos) {
      const id = this.readAsciiString(pos, 4);
      if (!id || id.charCodeAt(0) < 32) break;
      const size = this.dataView.getUint32(pos + 4, false);
      const payloadEnd = pos + 8 + size + (size % 2);
      if (payloadEnd > this.fileSize) {
        // Truncated — still record chunk for detectIffTruncation; stop walking.
        chunks.push({ id, size, offset: pos + 8 });
        break;
      }
      chunks.push({ id, size, offset: pos + 8 });
      pos += 8 + size;
      // pad to even (IFF rule)
      if (size % 2 === 1) pos++;
    }

    return chunks;
  }

  /**
   * Parse nested IFF chunks within a parent chunk (e.g. CAT DEVL, CAT TRKL).
   * Nested CATs have: "CAT " + size + formType (4 bytes) + child chunks.
   */
  private parseNestedChunks(parentOffset: number, parentSize: number): IffChunk[] {
    const chunks: IffChunk[] = [];
    // Nested CAT: first 4 bytes of payload are the form type (e.g. "DEVL", "TRKL")
    let pos = parentOffset + 4; // skip form type
    const maxPos = parentOffset + parentSize;

    while (pos + 8 <= maxPos) {
      const id = this.readAsciiString(pos, 4);
      if (!id || id.charCodeAt(0) < 32) break;
      const size = this.dataView.getUint32(pos + 4, false);
      const payloadEnd = pos + 8 + size + (size % 2);
      if (payloadEnd > parentOffset + parentSize && payloadEnd > this.fileSize) {
        chunks.push({ id, size, offset: pos + 8 });
        break;
      }
      chunks.push({ id, size, offset: pos + 8 });
      pos += 8 + size;
      if (size % 2 === 1) pos++; // IFF padding
    }

    return chunks;
  }

  /**
   * Attempt to parse full IFF CAT RB40 song data from detected chunks.
   * Returns RawRbsData with songData populated, or null if not enough data.
   * Ref: RBS42.txt file structure, rbs.h structs.
   */
  private parseIffSongData(topChunks: IffChunk[]): RawRbsData | null {
    // Find key chunks
    const headChunk = topChunks.find(c => c.id === 'HEAD');
    const globChunk = topChunks.find(c => c.id === 'GLOB');
    // Nested CAT chunks appear as "CAT " with form types DEVL, TRKL
    const catChunks = topChunks.filter(c => c.id === 'CAT ');

    // We need at minimum a HEAD chunk to proceed
    if (!headChunk) return null;

    this.onProgress?.(10);

    // Parse HEAD (256 bytes: version signature, copyright)
    const version = this.parseIffHead(headChunk);

    // Parse GLOB if present (512 bytes: play mode, tempo, shuffle, loop points)
    const glob = globChunk ? this.parseIffGlob(globChunk) : this.defaultGlob();

    this.onProgress?.(20);

    // Find DEVL and TRKL nested catalogs
    let devlChunks: IffChunk[] = [];
    let trklChunks: IffChunk[] = [];
    for (const cat of catChunks) {
      // Read form type from the payload start
      const formType = this.readAsciiString(cat.offset, 4);
      if (formType === 'DEVL') {
        devlChunks = this.parseNestedChunks(cat.offset, cat.size);
      } else if (formType === 'TRKL') {
        trklChunks = this.parseNestedChunks(cat.offset, cat.size);
      }
    }

    this.onProgress?.(40);

    // Parse device patterns from DEVL (multi-pattern banks)
    const patternBanks = this.parseDevlPatterns(devlChunks);

    this.onProgress?.(70);

    // Parse TRAK events from TRKL (song arrangement)
    const tracks = this.parseTrklTracks(trklChunks);

    this.onProgress?.(90);

    // Compute song statistics
    let maxTick = 0;
    const usedPatterns = new Set<number>();
    for (const track of tracks) {
      for (const evt of track.events) {
        if (evt.absoluteTicks > maxTick) maxTick = evt.absoluteTicks;
        if (evt.controllerId === 0) usedPatterns.add(evt.value); // pattern select
      }
    }
    const totalLengthBars = Math.ceil(maxTick / TICKS_PER_BAR) || 1;

    const songData: RbsSongData = {
      glob,
      patternBanks,
      tracks,
      totalLengthTicks: maxTick,
      totalLengthBars,
      usedPatternCount: usedPatterns.size || 1,
    };

    // Use pattern 0 from banks as the "current" pattern for backwards compatibility
    const tb303PatternA = patternBanks.tb303A[0] || this.generateMockTb303Pattern();
    const tb303PatternB = patternBanks.tb303B[0] || this.generateMockTb303PatternB();
    const drums = patternBanks.drums808[0] || patternBanks.drums909[0] || this.generateMockDrumPattern();

    const baseName = `RBS Song (${version})`;
    const rawData: RawRbsData = {
      version,
      project: {
        name: baseName,
        author: 'Imported from RBS',
        tempo: glob.tempo || 120,
        timeSignatureNum: 4,
        timeSignatureDen: 4,
        swing: glob.shuffle,
        patternLength: 16,
        createdAt: new Date(),
        sourceSoftware: 'ReBirth RB-338',
      },
      tb303PatternA,
      tb303PatternB,
      drums,
      pcf: this.generateMockPcfSettings(), // PCF extracted from DEVL in future refinement
      automation: [],
      songData,
    };

    return rawData;
  }

  /**
   * Parse HEAD chunk from IFF container (256 bytes).
   * Returns version string.
   */
  private parseIffHead(chunk: IffChunk): string {
    // HEAD typically contains a version signature in first bytes
    // Format varies but common: null-terminated string or "RB40" marker
    const offset = chunk.offset;
    const sig = this.readNullTerminatedString(offset, Math.min(chunk.size, 64));
    
    // Try to extract version from signature
    const versionMatch = sig.match(/(\d+\.\d+(?:\.\d+)?)/);
    if (versionMatch) return versionMatch[1];
    
    // Check for known patterns
    if (sig.includes('RB40') || sig.includes('RB-338')) return '2.0';
    if (sig.includes('RB15')) return '1.5';
    
    return '2.0'; // default for IFF CAT RB40 files
  }

  /**
   * Parse GLOB chunk (512 bytes: play mode, tempo, shuffle, loop points, vintage).
   * Ref: RBS42.txt GLOB layout, rbs.h struct glob_t.
   * Layout (little-endian):
   *   0x00: play_mode (uint8): 0=pattern, 1=song
   *   0x01: reserved (1 byte)
   *   0x02: tempo (uint16 LE) — BPM * 10 (e.g. 1200 = 120.0 BPM)
   *   0x04: shuffle (uint8) — 0-127
   *   0x05: reserved (1 byte)
   *   0x06: loop_start (uint16 LE) — bar index
   *   0x08: loop_end (uint16 LE) — bar index
   *   0x0A: vintage (uint8): 0=off, 1=on
   */
  private parseIffGlob(chunk: IffChunk): RbsGlobData {
    const o = chunk.offset;
    const playMode = this.rawBytes[o] === 1 ? 1 : 0;
    const tempoRaw = this.dataView.getUint16(o + 2, true);
    const tempo = tempoRaw > 0 ? tempoRaw / 10 : 120;
    const shuffle = this.rawBytes[o + 4];
    const loopStart = this.dataView.getUint16(o + 6, true);
    const loopEnd = this.dataView.getUint16(o + 8, true);
    const vintage = this.rawBytes[o + 10] || 0;

    return { playMode, tempo, shuffle, loopStart, loopEnd, vintage };
  }

  /**
   * Default GLOB when chunk is missing (v1.5 files may lack it).
   */
  private defaultGlob(): RbsGlobData {
    return { playMode: 0, tempo: 120, shuffle: 64, loopStart: 0, loopEnd: 0, vintage: 0 };
  }

  /**
   * Parse device patterns from DEVL catalog chunks.
   * DEVL contains per-device chunks with all 32 patterns.
   * Returns pattern banks for each device type.
   */
  private parseDevlPatterns(devlChunks: IffChunk[]): RbsSongData['patternBanks'] {
    const banks: RbsSongData['patternBanks'] = {
      tb303A: [],
      tb303B: [],
      drums808: [],
      drums909: [],
    };

    // DEVL chunks contain device data; each device has ~32 patterns
    // For now, extract what we can based on chunk sizes:
    // - TB303 device: ~1097 bytes per pattern (16 steps × ~68B + params)
    // - TR808: ~6KB total (~192B per pattern × 32)
    // - TR909: ~6KB total
    // We generate pattern 0 from the legacy parser path as baseline
    // and populate additional patterns from chunk data when recognizable.
    
    for (const chunk of devlChunks) {
      const chunkId = chunk.id;
      // Device chunks inside DEVL may be tagged by type
      // Common: "3031" (303 #1), "3032" (303 #2), "808 " (TR-808), "909 " (TR-909)
      if (chunkId === '3031' || chunkId === '303A') {
        this.extractTb303Patterns(chunk, banks.tb303A);
      } else if (chunkId === '3032' || chunkId === '303B') {
        this.extractTb303Patterns(chunk, banks.tb303B);
      } else if (chunkId === '808 ' || chunkId === 'TR80') {
        this.extractDrumPatterns(chunk, banks.drums808);
      } else if (chunkId === '909 ' || chunkId === 'TR90') {
        this.extractDrumPatterns(chunk, banks.drums909);
      }
    }

    // Ensure at least one pattern per bank (fallback to mock data for compatibility)
    if (banks.tb303A.length === 0) banks.tb303A.push(this.generateMockTb303Pattern());
    if (banks.tb303B.length === 0) banks.tb303B.push(this.generateMockTb303PatternB());
    if (banks.drums808.length === 0) banks.drums808.push(this.generateMockDrumPattern());
    if (banks.drums909.length === 0) banks.drums909.push(this.generateMockDrumPattern());

    return banks;
  }

  /**
   * Extract TB-303 patterns from a device chunk.
   * Each pattern: 16 steps × (note + octave + flags + gate = ~4 bytes each) + global params.
   * Simplified extraction: reads contiguous blocks of step data.
   */
  private extractTb303Patterns(chunk: IffChunk, target: Tb303PatternA[]): void {
    const offset = chunk.offset;
    const size = chunk.size;
    // Approximate pattern size: 16 steps × 4 bytes + 8 bytes params = 72 bytes
    const PATTERN_BLOCK_SIZE = 72;
    const maxPatterns = Math.min(32, Math.floor(size / PATTERN_BLOCK_SIZE));

    for (let p = 0; p < maxPatterns; p++) {
      const pOffset = offset + (p * PATTERN_BLOCK_SIZE);
      if (pOffset + PATTERN_BLOCK_SIZE > offset + size) break;

      const steps: Tb303PatternA['steps'] = [];
      for (let s = 0; s < 16; s++) {
        const stepOffset = pOffset + (s * 4);
        const noteVal = this.rawBytes[stepOffset] || 0;
        const octave = this.rawBytes[stepOffset + 1] || 3;
        const flags = this.rawBytes[stepOffset + 2] || 0;
        const gate = this.rawBytes[stepOffset + 3] || 100;

        let note: number;
        let tie = false;
        if (noteVal === NOTE_REST) {
          note = -1;
        } else if (noteVal === NOTE_TIE) {
          note = -1;
          tie = true;
        } else {
          note = noteVal % 12;
        }

        steps.push({
          index: s,
          note,
          octave: this.clamp(octave, 1, 5),
          accent: !!(flags & 0x01),
          slide: !!(flags & 0x02),
          tie,
          gate: this.clamp(gate, 0, 100),
        });
      }

      // Params after 64 bytes of step data
      const paramOffset = pOffset + 64;
      const cutoff = this.rawBytes[paramOffset] || 64;
      const resonance = this.rawBytes[paramOffset + 1] || 48;
      const envMod = this.rawBytes[paramOffset + 2] || 64;
      const decay = this.rawBytes[paramOffset + 3] || 48;
      const accent = this.rawBytes[paramOffset + 4] || 80;
      const waveform = (this.rawBytes[paramOffset + 5] || 0) as 0 | 1;

      target.push({
        steps,
        cutoff, resonance, envMod, decay, accent, waveform,
        distortion: 0,
        delaySend: 0,
      });
    }
  }

  /**
   * Extract drum patterns from a device chunk.
   * Each pattern: multiple instrument lanes × 16 boolean steps.
   */
  private extractDrumPatterns(chunk: IffChunk, target: DrumPattern[]): void {
    const offset = chunk.offset;
    const size = chunk.size;
    // Drum pattern block: 4 instruments × 16 steps (2 bytes per step: trigger + accent) = 128 bytes + extras
    const PATTERN_BLOCK_SIZE = 192; // includes accent + tuning + decay data
    const maxPatterns = Math.min(32, Math.floor(size / PATTERN_BLOCK_SIZE));

    for (let p = 0; p < maxPatterns; p++) {
      const pOffset = offset + (p * PATTERN_BLOCK_SIZE);
      if (pOffset + 64 > offset + size) break; // at least 64 bytes needed

      const kick: boolean[] = [];
      const snare: boolean[] = [];
      const closedHat: boolean[] = [];
      const openHat: boolean[] = [];

      for (let s = 0; s < 16; s++) {
        kick.push(!!(this.rawBytes[pOffset + s] & 0x01));
        snare.push(!!(this.rawBytes[pOffset + 16 + s] & 0x01));
        closedHat.push(!!(this.rawBytes[pOffset + 32 + s] & 0x01));
        openHat.push(!!(this.rawBytes[pOffset + 48 + s] & 0x01));
      }

      target.push({
        kick, snare, closedHat, openHat,
        kitType: '808',
      });
    }
  }

  /**
   * Parse TRKL catalog TRAK chunks into track arrangement data.
   * Each TRAK: uint32 event_count + events (each: uint16 delta + uint8 ctrl + uint8 value = 4 bytes).
   * Ref: RBS42.txt TRAK event format, rbs.h struct trak_t.
   */
  private parseTrklTracks(trklChunks: IffChunk[]): RbsTrakData[] {
    const trackNames = ['Mixer', 'TB-303 #1', 'TB-303 #2', 'TR-808', 'TR-909', 'Effects'];
    const tracks: RbsTrakData[] = [];

    for (let i = 0; i < trklChunks.length; i++) {
      const chunk = trklChunks[i];
      if (chunk.id !== 'TRAK') continue;

      const track = this.parseSingleTrak(chunk, tracks.length, trackNames[tracks.length] || `Track ${tracks.length}`);
      tracks.push(track);
    }

    return tracks;
  }

  /**
   * Parse a single TRAK chunk into RbsTrakData.
   * Layout: uint32 event_count (LE) + event_count × (uint16 delta_ticks (LE) + uint8 controller_id + uint8 value).
   */
  private parseSingleTrak(chunk: IffChunk, index: number, name: string): RbsTrakData {
    const offset = chunk.offset;
    const events: RbsTrakEvent[] = [];

    // Read event count (little-endian uint32)
    if (chunk.size < 4) {
      return { trackIndex: index, trackName: name, eventCount: 0, events: [] };
    }

    const eventCount = this.dataView.getUint32(offset, true);
    let pos = offset + 4;
    let absoluteTicks = 0;

    const maxEvents = Math.min(eventCount, MAX_TRAK_EVENTS);
    for (let e = 0; e < maxEvents; e++) {
      if (pos + 4 > offset + chunk.size) break;

      const deltaTicks = this.dataView.getUint16(pos, true);
      const controllerId = this.rawBytes[pos + 2];
      const value = this.rawBytes[pos + 3];
      pos += 4;

      absoluteTicks += deltaTicks;
      events.push({ deltaTicks, absoluteTicks, controllerId, value });
    }

    return { trackIndex: index, trackName: name, eventCount: events.length, events };
  }

  /**
   * Generate mock RBS data for UI development/testing
   * Used as fallback when actual parsing fails or for testing
   */
  generateMockData(filename: string): RawRbsData {
    const baseName = filename.replace(/\.rbs$/i, '');
    
    return {
      version: '2.0',
      project: {
        name: baseName,
        author: 'Imported from RBS',
        tempo: 128,
        timeSignatureNum: 4,
        timeSignatureDen: 4,
        swing: 50,
        patternLength: 16,
        createdAt: new Date(),
        sourceSoftware: 'ReBirth RB-338'
      },
      tb303PatternA: this.generateMockTb303Pattern(),
      tb303PatternB: this.generateMockTb303PatternB(),
      drums: this.generateMockDrumPattern(),
      pcf: this.generateMockPcfSettings(),
      automation: this.generateMockAutomation()
    };
  }

  private generateMockTb303Pattern(): Tb303PatternA {
    const steps: Tb303PatternA['steps'] = [];
    const notes = [0, 0, 7, 7, 9, 9, 7, -1, 5, 5, 4, 4, 2, 2, 0, -1];
    
    for (let i = 0; i < 16; i++) {
      steps.push({
        index: i,
        note: notes[i] ?? -1,
        octave: notes[i] === -1 ? 3 : 3,
        accent: i === 3 || i === 7 || i === 11 || i === 15,
        slide: i === 6 || i === 14,
        tie: false,
        gate: 100
      });
    }

    return {
      steps,
      cutoff: 64,
      resonance: 48,
      envMod: 64,
      decay: 48,
      accent: 80,
      waveform: 1,
      distortion: 0,
      delaySend: 0
    };
  }

  private generateMockTb303PatternB(): Tb303PatternB {
    const pattern = this.generateMockTb303Pattern();
    return {
      ...pattern,
      transpose: 0
    };
  }

  private generateMockDrumPattern(): DrumPattern {
    const kick = [true, false, false, false, true, false, false, false, true, false, false, false, true, false, false, false];
    const snare = [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false];
    const closedHat = [false, true, false, true, false, true, false, true, false, true, false, true, false, true, false, true];
    const openHat = [false, false, false, false, false, false, false, false, false, false, false, false, false, false, true, false];

    return {
      kick,
      snare,
      closedHat,
      openHat,
      accent: Array(16).fill(0),
      kitType: '808',
      tuning: {
        kick: 0,
        snare: 0,
        closedHat: 0,
        openHat: 0
      },
      decay: {
        kick: 64,
        snare: 48,
        closedHat: 32,
        openHat: 64
      }
    };
  }

  private generateMockPcfSettings(): PcfSettings {
    return {
      enabled: true,
      filterType: 'lp',
      cutoff: 80,
      resonance: 40,
      envAmount: 60,
      decay: 40,
      pattern: Array(16).fill(0).map((_, i) => Math.floor(40 + Math.sin(i * Math.PI / 8) * 30)),
      target: {
        tb303A: true,
        tb303B: false,
        drums: false
      }
    };
  }

  private generateMockAutomation(): AutomationLane[] {
    return [
      {
        parameter: 'tempo',
        name: 'Tempo',
        points: [[0, 128], [8, 130], [15, 128]],
        interpolation: 'linear',
        range: [60, 200]
      }
    ];
  }

  /**
   * Validate RBS version string
   */
  static isVersionSupported(version: string): boolean {
    return SUPPORTED_VERSIONS.includes(version);
  }

  /**
   * Get list of supported versions
   */
  static getSupportedVersions(): string[] {
    return [...SUPPORTED_VERSIONS];
  }
}

/**
 * Convenience function for simple parsing
 */
export async function parseRbsFile(file: File, onProgress?: (percent: number) => void): Promise<RbsParserResult> {
  const parser = new RbsParser();
  parser.onProgress = onProgress;
  return parser.parseRbsFile(file);
}

export default RbsParser;
