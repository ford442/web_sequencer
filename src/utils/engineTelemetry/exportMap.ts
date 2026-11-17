// hyphon_native WASM export-map resolution (JSON map vs. glue recovery).

import { HYPHON_NATIVE_ARTIFACTS, type HyphonNativeThreading } from '../../audio-worklets/hyphonNativeImports';
import { resolvePublicAsset } from './publicAsset';

/**
 * Parse hyphon_native glue to recover minified WASM export names.
 * Used when the export map JSON is missing or stale (wasm-opt renames).
 * Mirrors tools/extract_wasm_export_map.mjs: the pthread glue quotes with `"`,
 * the single-threaded glue (hyphon_native.st.js) with `'`.
 */
export function parseHyphonGlueExportMap(glueSource: string): Record<string, string> {
  const map: Record<string, string> = {};
  // Release: `Module["_x"] = wasmExports["y"]`. Debug (ASSERTIONS) glue on emcc 6.x:
  // `Module["_x"] = createExportWrapper("x", wasmExports["y"], n)`.
  const re =
    /Module\[(["'])(_[^"']+)\1\]\s*=\s*(?:createExportWrapper\(\s*["'][^"']+["']\s*,\s*)?wasmExports\[(["'])([^"']+)\3\]/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(glueSource)) !== null) {
    map[match[2].slice(1)] = match[4];
  }
  return map;
}

/** Keys present in either map whose values disagree (including absent vs present). */
export function countExportMapDrift(
  jsonMap: Record<string, string>,
  glueMap: Record<string, string>,
): number {
  const keys = new Set([...Object.keys(jsonMap), ...Object.keys(glueMap)]);
  let drift = 0;
  for (const key of keys) {
    if (jsonMap[key] !== glueMap[key]) drift += 1;
  }
  return drift;
}

async function fetchJsonExportMap(threading: HyphonNativeThreading): Promise<Record<string, string>> {
  const jsonUrl = resolvePublicAsset(HYPHON_NATIVE_ARTIFACTS[threading].exportMap);
  try {
    const response = await fetch(jsonUrl);
    if (!response.ok) return {};
    const fromJson = (await response.json()) as Record<string, string>;
    if (fromJson && typeof fromJson === 'object' && !Array.isArray(fromJson)) {
      return fromJson;
    }
  } catch {
    /* missing or invalid */
  }
  return {};
}

async function fetchGlueExportMap(threading: HyphonNativeThreading): Promise<Record<string, string>> {
  const glueUrl = resolvePublicAsset(HYPHON_NATIVE_ARTIFACTS[threading].glue);
  try {
    const response = await fetch(glueUrl);
    if (!response.ok) return {};
    return parseHyphonGlueExportMap(await response.text());
  } catch {
    return {};
  }
}

async function loadHyphonWasmExportMapUncached(threading: HyphonNativeThreading): Promise<Record<string, string>> {
  const { exportMap, glue } = HYPHON_NATIVE_ARTIFACTS[threading];
  const [fromJson, fromGlue] = await Promise.all([fetchJsonExportMap(threading), fetchGlueExportMap(threading)]);
  const jsonCount = Object.keys(fromJson).length;
  const glueCount = Object.keys(fromGlue).length;

  if (glueCount > 0 && jsonCount > 0) {
    const drift = countExportMapDrift(fromJson, fromGlue);
    if (drift > 0) {
      console.warn(
        `[EngineTelemetry] ${exportMap} disagrees with ${glue} glue on ${drift} export(s); using glue`,
      );
      return fromGlue;
    }
    return fromJson;
  }

  if (glueCount > 0) {
    console.warn(
      `[EngineTelemetry] ${exportMap} empty or missing; recovered ${glueCount} exports from glue`,
    );
    return fromGlue;
  }

  return fromJson;
}

const exportMapPromises = new Map<HyphonNativeThreading, Promise<Record<string, string>>>();

/** Drop the memoized export-map fetch. For tests only. */
export function resetHyphonWasmExportMapCache(): void {
  exportMapPromises.clear();
}

/**
 * Load the WASM export map for one hyphon_native profile: JSON and glue in parallel.
 * Glue wins when it is non-empty and disagrees with JSON (stale identity maps).
 */
export async function loadHyphonWasmExportMap(
  threading: HyphonNativeThreading = 'pthread',
): Promise<Record<string, string>> {
  let promise = exportMapPromises.get(threading);
  if (!promise) {
    promise = loadHyphonWasmExportMapUncached(threading);
    exportMapPromises.set(threading, promise);
  }
  return promise;
}

