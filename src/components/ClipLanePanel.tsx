/**
 * Clip-local automation for the focused arrangement clip (#1494).
 *
 * The lanes are drawn by the existing lane editor (`CurveEditor`) in
 * clip-local steps: step 0 is the clip's left edge, `lengthSteps` its right
 * edge. Edits go through the arrangement's `onEdit`, so each one is a single
 * undo step on the stack Song Mode shares. Moving the clip moves its lanes;
 * a head trim shifts their origin (`updateClip`).
 */
import React, { memo, useCallback, useMemo, useState } from 'react';
import type { Arrangement, ArrangementClip, AutomationLanePoint, UnifiedAutomationLane } from '../types';
import { setClipLanes } from '../arrangement/model';
import { CLIP_LANE_TARGET } from '../arrangement/clipLanes';
import { generateLaneId } from '../stores/automationStore';
import { CurveEditor } from './automation/CurveEditor';

/** Parameters a clip lane can drive, per target: the ones live playback routes. */
const CLIP_LANE_PARAMS: Partial<Record<UnifiedAutomationLane['target'], ReadonlyArray<{ id: string; label: string }>>> = {
    synthA: [
        { id: 'filterCutoff', label: 'Cutoff' },
        { id: 'filterResonance', label: 'Resonance' },
        { id: 'decay', label: 'Decay' },
        { id: 'envMod', label: 'Env Mod' },
        { id: 'drive', label: 'Drive' },
    ],
    bass2: [
        { id: 'filterCutoff', label: 'Cutoff' },
        { id: 'filterResonance', label: 'Resonance' },
        { id: 'decay', label: 'Decay' },
        { id: 'envMod', label: 'Env Mod' },
        { id: 'drive', label: 'Drive' },
    ],
    sampler: [
        { id: 'filterCutoff', label: 'Cutoff' },
        { id: 'filterResonance', label: 'Resonance' },
        { id: 'volume', label: 'Volume' },
    ],
};
CLIP_LANE_PARAMS.synthB = CLIP_LANE_PARAMS.synthA;

export interface ClipLanePanelProps {
    clip: ArrangementClip;
    onEdit: (updater: (prev: Arrangement) => Arrangement) => void;
}

export const ClipLanePanel = memo(function ClipLanePanel({ clip, onEdit }: ClipLanePanelProps) {
    const target = CLIP_LANE_TARGET[clip.track];
    const params = useMemo(() => CLIP_LANE_PARAMS[target] ?? [], [target]);
    const lanes = useMemo(() => clip.lanes ?? [], [clip.lanes]);
    const [selectedLaneId, setSelectedLaneId] = useState<string | null>(null);
    const [param, setParam] = useState<string>(params[0]?.id ?? '');
    const lane = lanes.find((l) => l.id === selectedLaneId) ?? lanes[0] ?? null;

    const addLane = useCallback(() => {
        const existing = lanes.find((l) => l.target === target && l.parameter === param);
        if (existing) {
            setSelectedLaneId(existing.id);
            return;
        }
        const next: UnifiedAutomationLane = {
            id: generateLaneId(),
            target,
            parameter: param,
            name: params.find((p) => p.id === param)?.label ?? param,
            points: [],
            interpolation: 'linear',
            source: 'manual',
            scope: 'song',
            enabled: true,
        };
        onEdit((prev) => setClipLanes(prev, clip.id, [...(prev.clips.find((c) => c.id === clip.id)?.lanes ?? []), next]));
        setSelectedLaneId(next.id);
    }, [clip.id, lanes, onEdit, param, params, target]);

    const removeLane = useCallback((id: string) => {
        onEdit((prev) => setClipLanes(prev, clip.id, (prev.clips.find((c) => c.id === clip.id)?.lanes ?? []).filter((l) => l.id !== id)));
    }, [clip.id, onEdit]);

    const changePoints = useCallback((points: AutomationLanePoint[]) => {
        if (!lane) return;
        onEdit((prev) => setClipLanes(
            prev,
            clip.id,
            (prev.clips.find((c) => c.id === clip.id)?.lanes ?? []).map((l) => (l.id === lane.id ? { ...l, points } : l)),
        ));
    }, [clip.id, lane, onEdit]);

    if (params.length === 0 && lanes.length === 0) {
        return (
            <div className="px-4 py-2 font-mono text-[10px] text-gray-500">
                No clip automation for this track: live playback routes no {target} parameters.
            </div>
        );
    }

    const btn = 'px-2 py-0.5 text-[10px] font-bold rounded border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500';
    return (
        <div role="group" aria-label="Clip automation" className="flex flex-wrap items-start gap-3 px-4 py-2 border-t border-cyan-900/20 bg-[#0b0e12] font-mono text-[10px] text-gray-400">
            <div className="flex flex-col gap-1 min-w-[160px]">
                <div className="flex items-center gap-1">
                    <label className="flex items-center gap-1">
                        LANE
                        <select
                            aria-label="Clip lane parameter"
                            value={param}
                            onChange={(e) => setParam(e.target.value)}
                            className="bg-zinc-900 border border-zinc-700 rounded px-1 py-0.5 text-cyan-300"
                        >
                            {params.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                        </select>
                    </label>
                    <button type="button" onClick={addLane} disabled={!param} className={`${btn} bg-zinc-800 text-gray-300 border-zinc-700 hover:bg-zinc-700`}>
                        + LANE
                    </button>
                </div>
                <ul aria-label="Clip lanes" className="flex flex-col gap-0.5">
                    {lanes.map((l) => (
                        <li key={l.id} className="flex items-center gap-1">
                            <button
                                type="button"
                                aria-pressed={l.id === lane?.id}
                                onClick={() => setSelectedLaneId(l.id)}
                                className={`${btn} flex-1 text-left ${l.id === lane?.id ? 'bg-cyan-900/50 text-cyan-300 border-cyan-600' : 'bg-zinc-900 text-gray-400 border-zinc-700'}`}
                            >
                                {l.name} · {l.points.length}pts
                            </button>
                            <button
                                type="button"
                                aria-label={`Remove clip lane ${l.name}`}
                                onClick={() => removeLane(l.id)}
                                className="text-gray-500 hover:text-red-400 px-1 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500"
                            >
                                <span aria-hidden="true">✕</span>
                            </button>
                        </li>
                    ))}
                </ul>
            </div>
            {lane && (
                <CurveEditor
                    key={lane.id}
                    lane={lane}
                    totalSteps={clip.lengthSteps}
                    width={560}
                    height={110}
                    onChangePoints={changePoints}
                />
            )}
        </div>
    );
});

export default ClipLanePanel;
