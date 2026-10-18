// PatchBayPalette — add a processing node to the patch.
//
// Pick a node type, set its few parameters, add it; then cable it in on the
// canvas. A new node changes the node set, so the controller stages it for the
// next engine restart and the patch bay says so.

import React, { memo, useMemo, useState } from 'react';

import {
    NODE_PALETTE,
    createPaletteNode,
    paletteDefaults,
    type AudioGraphConfig,
    type GraphNodeSpec,
} from '../audio/graph';

interface PatchBayPaletteProps {
    config: AudioGraphConfig;
    onAdd: (node: GraphNodeSpec) => boolean;
}

export const PatchBayPalette: React.FC<PatchBayPaletteProps> = memo(({ config, onAdd }) => {
    const [entryIndex, setEntryIndex] = useState(0);
    const entry = NODE_PALETTE[entryIndex];
    const [values, setValues] = useState<Record<string, number>>(() => paletteDefaults(NODE_PALETTE[0]));

    const preview = useMemo(() => createPaletteNode(config, entry, values), [config, entry, values]);

    return (
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Add node">
            <label className="flex items-center gap-1 font-mono text-[9px] uppercase text-gray-400">
                Add
                <select
                    value={entryIndex}
                    onChange={(event) => {
                        const index = Number(event.target.value);
                        setEntryIndex(index);
                        setValues(paletteDefaults(NODE_PALETTE[index]));
                    }}
                    aria-label="Node type"
                    className="rounded border border-cyan-500/30 bg-black/40 px-1 py-0.5 font-mono text-[10px] text-gray-200 focus:outline-none focus-visible:ring-1 focus-visible:ring-cyan-400"
                >
                    {NODE_PALETTE.map((candidate, index) => (
                        <option key={`${candidate.factory}-${candidate.label}`} value={index}>
                            {candidate.label}
                        </option>
                    ))}
                </select>
            </label>

            {entry.params.map((param) => (
                <label
                    key={param.key}
                    className="flex items-center gap-1 font-mono text-[9px] uppercase text-gray-400"
                >
                    {param.label}
                    <input
                        type="range"
                        min={param.min}
                        max={param.max}
                        step={param.step}
                        value={values[param.key] ?? param.defaultValue}
                        onChange={(event) =>
                            setValues((current) => ({ ...current, [param.key]: Number(event.target.value) }))
                        }
                        aria-label={`${entry.label} ${param.label}`}
                        className="w-20"
                    />
                    <span className="w-10 text-right text-gray-200">
                        {(values[param.key] ?? param.defaultValue).toFixed(param.step < 1 ? 2 : 0)}
                    </span>
                </label>
            ))}

            <button
                type="button"
                onClick={() => onAdd(preview)}
                className="rounded border border-purple-500/40 px-1.5 py-0.5 font-mono text-[9px] uppercase text-purple-200 hover:bg-purple-900/40 focus:outline-none focus-visible:ring-1 focus-visible:ring-purple-400"
            >
                Add {preview.label}
            </button>
        </div>
    );
});

PatchBayPalette.displayName = 'PatchBayPalette';
