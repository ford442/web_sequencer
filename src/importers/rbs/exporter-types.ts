/**
 * RBS export options and result types.
 */

import type { TrackKey } from '../../constants/appDefaults';

export type RbsExportVersionTarget = '1.5' | '2.0';
export type RbsExportMode = 'pattern' | 'song';

export interface RbsExportOptions {
  /** ReBirth file version string target. */
  versionTarget: RbsExportVersionTarget;
  /** Pattern mode (Phase 1) or song mode (Phase 2 stretch). */
  mode: RbsExportMode;
  /** Collapse Hyphon 32-step patterns to native 16-step ReBirth format. */
  collapse32Steps: boolean;
  /** Hyphon track mapped to TB-303 pattern A (inverse of import tb303ATarget). */
  tb303ASource: TrackKey;
  /** Hyphon track mapped to TB-303 pattern B. */
  tb303BSource: TrackKey;
  /** Drum kit chunk to populate. */
  drumKit: '808' | '909' | 'auto';
  /** Optional song name embedded in HEAD chunk. */
  songName?: string;
  /** Include PCF chunk from rbsMetadata / pcfFilter. */
  includePcf: boolean;
  /** Include second TB-303 device (false for v1.5 subset). */
  include303B: boolean;
}

export const DEFAULT_RBS_EXPORT_OPTIONS: RbsExportOptions = {
  versionTarget: '2.0',
  mode: 'pattern',
  collapse32Steps: true,
  tb303ASource: 'partA',
  tb303BSource: 'bass2',
  drumKit: 'auto',
  includePcf: true,
  include303B: true,
};

export interface RbsExportResult {
  success: boolean;
  blob?: Blob;
  bytes?: Uint8Array;
  warnings: string[];
  error?: string;
}
