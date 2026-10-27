/**
 * Clip-local automation (#1494).
 *
 * A clip lane is a `UnifiedAutomationLane` whose point steps are clip-local:
 * 0 is the clip's left edge, `lengthSteps` its right edge. It moves with the
 * clip, and a head trim shifts its origin with `offsetSteps`.
 *
 * There is one resolver. `layerClipLanes` (`./playback`) turns the lanes of the clips that
 * sound at a song step into song-timeline lanes and puts them ahead of the
 * song lanes, so `resolveLaneValuesAtStep` / `resolveParamAtStep` (first lane
 * per `target:parameter` wins) give the clip value on the steps the clip
 * covers and leave the song lane alone everywhere else. The live step handler
 * and every offline render call it with the same song step.
 */
import type { TrackKey } from '@/constants/appDefaults';
import type {
    AutomationInterpolation,
    AutomationLanePoint,
    AutomationTarget,
    UnifiedAutomationLane,
} from '@/types/automation';

/** The lane target a clip on `track` automates by default. */
export const CLIP_LANE_TARGET: Readonly<Record<TrackKey, AutomationTarget>> = {
    partA: 'synthA',
    partB: 'synthB',
    bass2: 'bass2',
    kick: 'kick',
    snare: 'snare',
    closedHat: 'closedHat',
    openHat: 'openHat',
    sampler: 'sampler',
};

/** Move every point by `-delta` steps: the lane origin follows a head trim or split. */
export function shiftClipLanes(
    lanes: readonly UnifiedAutomationLane[] | undefined,
    delta: number,
): UnifiedAutomationLane[] | undefined {
    if (!lanes || lanes.length === 0) return lanes ? [] : undefined;
    if (delta === 0) return lanes.slice();
    return lanes.map((lane) => ({
        ...lane,
        points: lane.points.map((p) => ({ ...p, step: p.step - delta })),
    }));
}

// ---------------------------------------------------------------------------
// Load-time validation
// ---------------------------------------------------------------------------

const INTERPOLATIONS: ReadonlySet<string> = new Set(['step', 'linear', 'smooth']);

function normalizePoint(raw: unknown): AutomationLanePoint | null {
    if (!raw || typeof raw !== 'object') return null;
    const p = raw as Record<string, unknown>;
    if (typeof p.step !== 'number' || !Number.isFinite(p.step)) return null;
    if (typeof p.value !== 'number' || !Number.isFinite(p.value)) return null;
    const point: AutomationLanePoint = { step: p.step, value: Math.max(0, Math.min(1, p.value)) };
    if (typeof p.interpolation === 'string' && INTERPOLATIONS.has(p.interpolation)) {
        point.interpolation = p.interpolation as AutomationInterpolation;
    }
    if (p.accent === true) point.accent = true;
    if (p.slide === true) point.slide = true;
    return point;
}

/**
 * Validate persisted clip lanes. Malformed lanes and points are dropped,
 * points are sorted; returns undefined when nothing valid is left.
 */
export function normalizeClipLanes(raw: unknown): UnifiedAutomationLane[] | undefined {
    if (!Array.isArray(raw)) return undefined;
    const lanes: UnifiedAutomationLane[] = [];
    for (const item of raw) {
        if (!item || typeof item !== 'object') continue;
        const l = item as Record<string, unknown>;
        if (typeof l.id !== 'string' || typeof l.target !== 'string' || typeof l.parameter !== 'string') continue;
        if (!Array.isArray(l.points)) continue;
        const points = (l.points as unknown[])
            .map(normalizePoint)
            .filter((p): p is AutomationLanePoint => p !== null)
            .sort((a, b) => a.step - b.step);
        lanes.push({
            id: l.id,
            target: l.target as AutomationTarget,
            parameter: l.parameter,
            name: typeof l.name === 'string' ? l.name : l.parameter,
            points,
            interpolation: typeof l.interpolation === 'string' && INTERPOLATIONS.has(l.interpolation)
                ? l.interpolation as AutomationInterpolation
                : 'linear',
            source: l.source === 'rbs' || l.source === 'recorded' || l.source === 'ai' ? l.source : 'manual',
            scope: 'song',
            enabled: l.enabled !== false,
            ...(Array.isArray(l.originalRange) && l.originalRange.length === 2
                ? { originalRange: [Number(l.originalRange[0]), Number(l.originalRange[1])] as [number, number] }
                : {}),
        });
    }
    return lanes.length ? lanes : undefined;
}
