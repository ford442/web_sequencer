/**
 * Song ↔ patch-bay glue.
 *
 * Loading a song can happen before *or* after the audio engine starts, so this
 * module works in both orders: it publishes a controller carrying the saved
 * patch either way, and the engine lifecycle picks up an existing controller
 * rather than overwriting it.
 */

import { deserializeAudioGraph, type SerializedAudioGraph } from './graphSerialization';
import { PatchController } from './patchController';
import { getActivePatchController, setActivePatchController } from './patchRegistry';
import { buildPreset, DEFAULT_PRESET_ID } from './presets';
import type { AudioGraphConfig } from './types';

export interface PatchRestoreResult {
    /** Config now in force. */
    config: AudioGraphConfig;
    /** True when the engine must recompile before the patch is audible. */
    requiresRebuild: boolean;
    /** True when a stored patch was present but unusable and the preset was used. */
    fellBack: boolean;
}

/**
 * Apply a song's stored routing.
 *
 * A missing, stock or corrupted entry loads the preset — never an error path
 * the user has to deal with, since a bad patch must not block opening a song.
 */
export function restorePatchFromSong(
    stored: SerializedAudioGraph | undefined,
): PatchRestoreResult {
    const { presetId, graph } = deserializeAudioGraph(stored, DEFAULT_PRESET_ID);
    const hadStoredPatch = Boolean(stored && (stored as { graph?: unknown }).graph);

    const preset = buildPreset(presetId);
    const config = graph ?? preset;

    const existing = getActivePatchController();
    if (existing) {
        const outcome = existing.replaceConfig(config);
        return {
            config: existing.getConfig(),
            requiresRebuild: outcome.requiresRebuild ?? false,
            fellBack: hadStoredPatch && graph === null,
        };
    }

    // Engine not started yet: stage the controller so lifecycle adopts it.
    const controller = new PatchController(config, preset);
    setActivePatchController(controller);
    return {
        config,
        requiresRebuild: false,
        fellBack: hadStoredPatch && graph === null,
    };
}
