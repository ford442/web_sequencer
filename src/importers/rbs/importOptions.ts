/**
 * RBS import options: defaults and the TB-303 → Hyphon track routing helper.
 *
 * Kept in its own module (rather than `types.ts`) so that low-level mapping
 * tables such as `trakControllers.ts` can read the default routing without
 * creating an import cycle through the type barrel.
 */

import type { RbsImportOptions, HyphonAutomationLane } from './types';

/** Default import options */
export const DEFAULT_RBS_IMPORT_OPTIONS: RbsImportOptions = {
  /** v1.5 files expose a single TB-303 — maps to partA (SYNTH A) by default. */
  tb303ATarget: 'partA',
  tb303BTarget: 'bass2',
  convertPcfToAutomation: true,
  importSwing: true,
  drumKitMapping: 'auto',
  expandTo32Steps: true,
  interpolateAutomation: true,
  quantizeTo16th: true,
  importPcfAsFilter: false,
};

/**
 * Resolve a `tb303ATarget` / `tb303BTarget` option string to the automation
 * lane target for that voice.
 *
 * This is the single source of truth for TB-303 routing: notes (pattern
 * conversion), knob automation lanes and TRAK events must all resolve through
 * it so a TB-303 track's notes and its automation land on the same voice.
 */
export function resolveTb303Target(
  option: 'partA' | 'partB' | 'bass2',
): HyphonAutomationLane['target'] {
  switch (option) {
    case 'bass2': return 'bass2';
    case 'partB': return 'synthB';
    case 'partA':
    default: return 'synthA';
  }
}
