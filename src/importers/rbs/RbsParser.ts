import type { RawRbsData } from './types';
import { isV15SubsetVersion } from './parser-types';
import type { RbsParserResult, RbsParserError } from './parser-types';
import { MIN_FILE_SIZE, SUPPORTED_VERSIONS } from './parser-types';
import { inferDevicesPresent, isTb303PatternSilent } from './deviceInference';
import type { ParserBinaryContext } from './parser/parserContext';
import {
  parseHeader,
  parseTb303PatternA,
  parseTb303PatternB,
  parseDrumPatterns,
  parsePcfSettings,
  parseAutomation,
} from './parser/legacyParse';
import {
  validateVersion,
  detectIffTruncation,
  parseIffChunks,
  parseIffSongData,
  parseIffHead,
} from './parser/iffParse';
import {
  generateEmptyTb303PatternB,
  generateMockTb303Pattern,
  generateMockTb303PatternB,
  generateMockDrumPattern,
  generateMockPcfSettings,
  generateMockAutomation,
} from './parser/mockData';

export class RbsParser {
  /** Parse progress callback (0-100) */
  onProgress?: (percent: number) => void;

  private dataView!: DataView;
  private rawBytes!: Uint8Array;
  private fileSize!: number;

  private ctx(): ParserBinaryContext {
    return {
      dataView: this.dataView,
      rawBytes: this.rawBytes,
      fileSize: this.fileSize,
      onProgress: this.onProgress,
    };
  }

  /**
   * Parse raw bytes (test / programmatic entry point).
   * Never throws — all failures are returned as `{ success: false, error }`.
   */
  async parseBytes(
    bytes: Uint8Array,
    options: { filename?: string; requireExtension?: boolean } = {},
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

      const ctx = this.ctx();
      const iffChunks = parseIffChunks(ctx);
      if (iffChunks.length > 0) {
        const truncationError = detectIffTruncation(ctx, iffChunks);
        if (truncationError) {
          return { success: false, error: truncationError };
        }

        const headChunk = iffChunks.find((c) => c.id === 'HEAD');
        if (headChunk) {
          const iffVersion = parseIffHead(ctx, headChunk);
          const versionError = validateVersion(iffVersion);
          if (versionError) {
            return { success: false, error: versionError };
          }
        }

        console.info(`[RbsParser] Detected full IFF CAT RB40 structure with ${iffChunks.length} top-level chunks. Attempting full song parse.`);
        const iffResult = parseIffSongData(ctx, iffChunks);
        if (iffResult) {
          this.onProgress?.(100);
          return { success: true, data: iffResult };
        }
        console.info('[RbsParser] IFF song data incomplete, falling back to legacy single-pattern extraction.');
      }

      const headerResult = parseHeader(ctx);
      if (!headerResult.success) {
        return { success: false, error: (headerResult as { success: false; error: RbsParserError }).error };
      }
      const header = headerResult.data;
      const versionError = validateVersion(header.version);
      if (versionError) {
        return { success: false, error: versionError };
      }
      this.onProgress?.(10);

      const tb303A = parseTb303PatternA(ctx);
      this.onProgress?.(40);

      let tb303B = parseTb303PatternB(ctx);
      if (isV15SubsetVersion(header.version) || isTb303PatternSilent(tb303B)) {
        tb303B = generateEmptyTb303PatternB();
      }
      this.onProgress?.(70);

      const drums = parseDrumPatterns(ctx);
      this.onProgress?.(85);

      const pcf = parsePcfSettings(ctx);
      this.onProgress?.(95);

      const automation = parseAutomation(ctx);
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
        parsePath: 'legacy',
      };
      rawData.devicesPresent = inferDevicesPresent(rawData);

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

  /** Main entry point: parse an .rbs file */
  async parseRbsFile(file: File): Promise<RbsParserResult> {
    const arrayBuffer = await file.arrayBuffer();
    return this.parseBytes(new Uint8Array(arrayBuffer), { filename: file.name, requireExtension: true });
  }

  /** Generate mock RBS data for UI development/testing */
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
        sourceSoftware: 'ReBirth RB-338',
      },
      tb303PatternA: generateMockTb303Pattern(),
      tb303PatternB: generateMockTb303PatternB(),
      drums: generateMockDrumPattern(),
      pcf: generateMockPcfSettings(),
      automation: generateMockAutomation(),
    };
  }

  static isVersionSupported(version: string): boolean {
    return SUPPORTED_VERSIONS.includes(version);
  }

  static getSupportedVersions(): string[] {
    return [...SUPPORTED_VERSIONS];
  }
}

/** Convenience function for simple parsing */
export async function parseRbsFile(file: File, onProgress?: (percent: number) => void): Promise<RbsParserResult> {
  const parser = new RbsParser();
  parser.onProgress = onProgress;
  return parser.parseRbsFile(file);
}

export default RbsParser;
