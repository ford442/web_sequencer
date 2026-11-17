/**
 * The pack actions the Session Launcher calls, as types only. The app wires
 * them to real state in `useSessionPacks`; the component and its tests never
 * see how. Every result is data — a failed action reports issues and has
 * changed nothing.
 */

import type { PackIssue, SessionPack } from './format';
import type { SlotCollisionPolicy } from './plan';
import type { PackPreview } from './preview';

export type PackPreviewResult =
  | { ok: true; preview: PackPreview }
  | { ok: false; errors: PackIssue[] };

export type PackLoadResult =
  | { ok: true; message: string }
  | { ok: false; errors: PackIssue[] };

export type PackExportOutcome =
  | { ok: true; filename: string; warnings: string[] }
  | { ok: false; errors: PackIssue[] };

export interface PackFileActions {
  /** Packs imported (and loaded) this session, oldest first. */
  imported: ReadonlyArray<{ id: string; name: string }>;
  /** Parse and validate a picked file. Applies nothing. */
  previewFile: (file: File) => Promise<PackPreviewResult>;
  /** Preview an earlier import again. Applies nothing. */
  previewImported: (id: string) => Promise<PackPreviewResult>;
  /** The explicit load: replaces the session document, merges patterns, applies instruments. */
  confirmLoad: (pack: SessionPack, policy: SlotCollisionPolicy) => Promise<PackLoadResult>;
  /** Build the current session as a pack and hand it to the browser as a download. */
  exportPack: (name: string) => Promise<PackExportOutcome>;
  /** One-click load of a data-file starter (same semantics as the built-in starters). */
  loadLibraryPack: (id: string) => Promise<PackLoadResult>;
}
