/**
 * Pack text → a preview, ready for the user to accept. This is the whole
 * import: nothing after it runs until `planPackLoad` is applied on an explicit
 * confirm, so every failure here leaves the active session exactly as it was.
 */

import type { TrackStorageMap } from '@/utils/trackStorageUtils';
import { PACK_LIMITS, type PackIssue, type SessionPack } from './format';
import { resolvePackId } from './plan';
import { previewPack, type PackPreview } from './preview';
import { parseSessionPackText } from './validate';

export interface PackImportContext {
  /** Ids already in use: built-in starters, library starters and earlier imports. */
  takenIds: Iterable<string>;
  /** The live pattern slots, to report what loading would collide with. */
  currentStorage: TrackStorageMap;
}

export type PackImportOutcome =
  | { ok: true; preview: PackPreview }
  | { ok: false; errors: PackIssue[] };

/**
 * Re-importing the same pack keeps its id (it is the same pack, and replaces
 * the earlier import). Only a *different* pack under a taken id is renamed —
 * decided by `sameContent`, which the caller supplies from its registry.
 */
export function importPackText(
  text: string,
  context: PackImportContext,
  sameContent: (pack: SessionPack) => boolean = () => false,
): PackImportOutcome {
  const parsed = parseSessionPackText(text);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };

  const { pack } = parsed;
  const taken = new Set(context.takenIds);
  const id = taken.has(pack.id) && !sameContent(pack) ? resolvePackId(pack.id, taken) : pack.id;
  const resolved: SessionPack = id === pack.id ? pack : { ...pack, id };
  const preview = previewPack(resolved, context.currentStorage, parsed.warnings.map((w) => w.message));
  return { ok: true, preview: id === pack.id ? preview : { ...preview, renamedFrom: pack.id } };
}

/**
 * Read a picked file and import it. The size is checked on the `File` before a
 * byte is read, so an oversized file never reaches memory as text.
 */
export async function importPackFile(
  file: Blob,
  context: PackImportContext,
  sameContent?: (pack: SessionPack) => boolean,
): Promise<PackImportOutcome> {
  if (file.size > PACK_LIMITS.maxBytes) {
    const mib = (PACK_LIMITS.maxBytes / (1024 * 1024)).toFixed(0);
    return {
      ok: false,
      errors: [{ code: 'too-large', path: '', message: `The file is larger than the ${mib} MiB limit for a session pack; nothing was read.` }],
    };
  }
  let text: string;
  try {
    text = await file.text();
  } catch {
    return { ok: false, errors: [{ code: 'invalid-json', path: '', message: 'The file could not be read.' }] };
  }
  return importPackText(text, context, sameContent);
}
