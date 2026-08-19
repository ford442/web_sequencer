import type { Wam2PluginInstanceState } from './types';
import { isAllowlistedPackageId } from './catalog';
import { integrityMatches } from './integrity';
import { getBundledPackage } from './catalog';

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
  missing: Wam2PluginInstanceState[];
}

/**
 * Plan restore without substituting a different plugin when identity/version
 * cannot be honoured. Missing entries stay in the song as placeholders.
 */
export async function planWam2Restore(payload: Wam2SongPayload | undefined | null): Promise<Wam2RestorePlan> {
  if (!payload || !Array.isArray(payload.plugins)) {
    return { load: [], missing: [] };
  }
  const load: Wam2PluginInstanceState[] = [];
  const missing: Wam2PluginInstanceState[] = [];

  for (const plugin of payload.plugins) {
    if (!isAllowlistedPackageId(plugin.packageId)) {
      missing.push(plugin);
      continue;
    }
    const bundled = await getBundledPackage(plugin.packageId);
    if (!bundled || bundled.version !== plugin.version) {
      missing.push(plugin);
      continue;
    }
    if (!integrityMatches(plugin.integrity, bundled.integrity)) {
      missing.push(plugin);
      continue;
    }
    load.push(plugin);
  }
  return { load, missing };
}
