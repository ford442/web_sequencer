/**
 * Per-slot presets.
 *
 * A preset is scoped to `{ packageId, version }` and stored locally. It is never
 * applied across packages — see {@link WamHost.applyPreset}. Presets carry the
 * plugin's own opaque `getState()` payload alongside the param map, because a
 * plugin's meaningful state is not always expressible as params.
 */
export interface Wam2Preset {
  packageId: string;
  version: string;
  paramState: Record<string, number>;
  pluginState?: unknown;
}

export interface Wam2StoredPreset extends Wam2Preset {
  name: string;
  savedAt: string;
}

const STORAGE_KEY = 'hyphon.wam2.presets';
const MAX_PRESETS_PER_PACKAGE = 64;

type PresetTable = Record<string, Wam2StoredPreset[]>;

function read(): PresetTable {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as PresetTable;
  } catch {
    return {};
  }
}

function write(table: PresetTable): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(table));
  } catch {
    /* storage full or unavailable — presets are a convenience, not song data */
  }
}

export function listPresets(packageId: string): Wam2StoredPreset[] {
  const list = read()[packageId];
  return Array.isArray(list) ? list : [];
}

/** Save (or replace by name) a preset for the package the slot is running. */
export function savePreset(name: string, preset: Wam2Preset): Wam2StoredPreset {
  const trimmed = name.trim() || 'Untitled';
  const table = read();
  const list = Array.isArray(table[preset.packageId]) ? table[preset.packageId] : [];
  const stored: Wam2StoredPreset = {
    ...preset,
    paramState: { ...preset.paramState },
    name: trimmed,
    savedAt: new Date().toISOString(),
  };
  const next = list.filter((p) => p.name !== trimmed);
  next.unshift(stored);
  table[preset.packageId] = next.slice(0, MAX_PRESETS_PER_PACKAGE);
  write(table);
  return stored;
}

export function getPreset(packageId: string, name: string): Wam2StoredPreset | undefined {
  return listPresets(packageId).find((p) => p.name === name);
}

export function deletePreset(packageId: string, name: string): void {
  const table = read();
  const list = table[packageId];
  if (!Array.isArray(list)) return;
  table[packageId] = list.filter((p) => p.name !== name);
  write(table);
}
