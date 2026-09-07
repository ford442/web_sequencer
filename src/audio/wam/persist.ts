import type { Wam2PluginInstanceState } from './types';
import { resolveAllowlistedPackage } from './catalog';
import { integrityMatches } from './integrity';

export const WAM2_SONG_SCHEMA = 1 as const;

export interface Wam2SongPayload {
  schema: typeof WAM2_SONG_SCHEMA;
  plugins: Wam2PluginInstanceState[];
}

export function serializeWam2SongState(plugins: readonly Wam2PluginInstanceState[]): Wam2SongPayload {
  return {
    schema: WAM2_SONG_SCHEMA,
    plugins: plugins.map((p) => ({
      slotId: p.slotId,
      packageId: p.packageId,
      version: p.version,
      integrity: { ...p.integrity },
      placement: p.placement,
      attachToNodeId: p.attachToNodeId,
      interceptFromNodeId: p.interceptFromNodeId,
      trackKey: p.trackKey,
      paramState: { ...p.paramState },
      pluginState: p.pluginState,
      bypass: p.bypass,
    })),
  };
}

export interface Wam2RestorePlan {
  load: Wam2PluginInstanceState[];
  /** Instances only, kept for callers that do not need the reason. */
  missing: Wam2PluginInstanceState[];
  missingDetail: Wam2MissingEntry[];
}

/** Why a saved slot could not be restored — surfaced in the HUD, never hidden. */
export type Wam2MissingReason =
  | 'not-allowlisted'
  | 'version-mismatch'
  | 'integrity-mismatch';

export interface Wam2MissingEntry {
  instance: Wam2PluginInstanceState;
  reason: Wam2MissingReason;
  detail: string;
}

export interface Wam2RestorePlanOptions {
  fetchImpl?: typeof fetch;
}

/**
 * Plan restore without substituting a different plugin when identity/version
 * cannot be honoured. Missing entries stay in the song as placeholders.
 *
 * Covers bundled fixtures and allowlisted community packages alike: for a
 * community package the saved integrity is the SHA-256 of the package file, so
 * a mismatch here means the bytes on disk changed since the song was saved —
 * exactly the case where loading anything would be a substitution.
 */
export async function planWam2Restore(
  payload: Wam2SongPayload | undefined | null,
  options: Wam2RestorePlanOptions = {},
): Promise<Wam2RestorePlan> {
  if (!payload || !Array.isArray(payload.plugins)) {
    return { load: [], missing: [], missingDetail: [] };
  }
  const load: Wam2PluginInstanceState[] = [];
  const missingDetail: Wam2MissingEntry[] = [];

  for (const plugin of payload.plugins) {
    const descriptor = await resolveAllowlistedPackage(plugin.packageId, options.fetchImpl);
    if (!descriptor) {
      missingDetail.push({
        instance: plugin,
        reason: 'not-allowlisted',
        detail: `${plugin.packageId} is not in the allowlist`,
      });
      continue;
    }
    if (descriptor.version !== plugin.version) {
      missingDetail.push({
        instance: plugin,
        reason: 'version-mismatch',
        detail: `saved ${plugin.packageId}@${plugin.version}, installed ${descriptor.version}`,
      });
      continue;
    }
    if (!integrityMatches(plugin.integrity, descriptor.integrity)) {
      missingDetail.push({
        instance: plugin,
        reason: 'integrity-mismatch',
        detail:
          `${plugin.packageId}: saved ${plugin.integrity.alg}:${plugin.integrity.value}, ` +
          `installed ${descriptor.integrity.alg}:${descriptor.integrity.value}`,
      });
      continue;
    }
    load.push(plugin);
  }
  return { load, missing: missingDetail.map((m) => m.instance), missingDetail };
}
