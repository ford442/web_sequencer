/**
 * Note FX strip of the piano roll (#1345 Phase 2): the open track's chain —
 * chord, arpeggiator, ratchet, Euclidean gate, humanize — edited in place.
 * Edits go to `noteFxStore` and are heard on the next step; the roll draws
 * the chain's output over the notes. "Freeze" writes that output back into
 * the steps (one undo entry) and bypasses the chain.
 */
import { memo, useId } from 'react';
import {
    ARP_MODES,
    ARP_RATES,
    chainIsActive,
    type NoteFxChain,
    type NoteFxModuleId,
} from '@/sequencer/noteFx/types';
import { NOTE_FX_AUTOMATION_PARAMS } from '@/sequencer/noteFx/params';

export interface NoteFxPanelProps {
    trackLabel: string;
    chain: NoteFxChain;
    onChange: <M extends NoteFxModuleId>(module: M, patch: Partial<NoteFxChain[M]>) => void;
    onFreeze: () => void;
    /** Create an automation lane for a chain parameter (`noteFx.*`). */
    onAutomate: (parameterId: string) => void;
}

const CHORD_PRESETS: ReadonlyArray<{ label: string; intervals: number[] }> = [
    { label: 'Major', intervals: [4, 7] },
    { label: 'Minor', intervals: [3, 7] },
    { label: 'Power (5th)', intervals: [7] },
    { label: 'Octave', intervals: [12] },
    { label: 'Sus4', intervals: [5, 7] },
    { label: 'Dom 7', intervals: [4, 7, 10] },
    { label: 'Min 7', intervals: [3, 7, 10] },
    { label: 'Maj 7', intervals: [4, 7, 11] },
];

const RATE_LABELS: Record<number, string> = { 0.25: '1/64', 0.5: '1/32', 1: '1/16', 2: '1/8', 4: '1/4' };

const fieldClass =
    'bg-[#11151b] border border-gray-700 rounded text-gray-200 text-[10px] px-1 py-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400';
const labelClass = 'flex items-center gap-1 text-[10px] font-mono text-gray-400';

function toggleClass(active: boolean): string {
    return `px-2 py-0.5 rounded border text-[10px] font-mono uppercase tracking-wider focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 ${
        active ? 'bg-amber-500/20 border-amber-400 text-amber-200' : 'bg-[#11151b] border-gray-700 text-gray-400 hover:text-white'
    }`;
}

interface ModuleProps {
    name: string;
    enabled: boolean;
    onToggle: () => void;
    children: React.ReactNode;
}

const Module = ({ name, enabled, onToggle, children }: ModuleProps) => (
    <fieldset className="flex flex-wrap items-center gap-2 px-2 py-1 rounded border border-gray-800 bg-[#0d1014]">
        <legend className="sr-only">{name}</legend>
        <button type="button" aria-pressed={enabled} className={toggleClass(enabled)} onClick={onToggle}>
            {name}
        </button>
        {children}
    </fieldset>
);

interface RangeProps {
    label: string;
    value: number;
    min: number;
    max: number;
    step: number;
    format: (v: number) => string;
    onChange: (v: number) => void;
}

const Range = ({ label, value, min, max, step, format, onChange }: RangeProps) => (
    <label className={labelClass}>
        {label}
        <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={value}
            aria-valuetext={format(value)}
            onChange={(e) => onChange(Number(e.target.value))}
            className="w-16 accent-amber-400"
        />
        <span className="w-8 text-right text-gray-300" aria-hidden="true">{format(value)}</span>
    </label>
);

const pct = (v: number) => `${Math.round(v * 100)}%`;

export const NoteFxPanel = memo(({ trackLabel, chain, onChange, onFreeze, onAutomate }: NoteFxPanelProps) => {
    const headingId = useId();
    const { chord, arp, ratchet, euclid, humanize } = chain;
    const presetIndex = CHORD_PRESETS.findIndex(
        (p) => p.intervals.length === chord.intervals.length && p.intervals.every((v, i) => v === chord.intervals[i]),
    );
    const active = chainIsActive(chain);

    return (
        <section aria-labelledby={headingId} data-testid="note-fx" className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-cyan-900/30 bg-[#0b0e12] shrink-0">
            <h3 id={headingId} className="font-orbitron text-[11px] tracking-[0.18em] text-amber-300 mr-1">
                NOTE FX <span className="sr-only">{`for ${trackLabel}`}</span>
            </h3>

            <Module name="Chord" enabled={chord.enabled} onToggle={() => onChange('chord', { enabled: !chord.enabled })}>
                <label className={labelClass}>
                    Shape
                    <select
                        value={presetIndex}
                        onChange={(e) => onChange('chord', { intervals: CHORD_PRESETS[Number(e.target.value)].intervals })}
                        className={fieldClass}
                    >
                        {presetIndex < 0 && <option value={-1}>{`Custom (${chord.intervals.join(', ')})`}</option>}
                        {CHORD_PRESETS.map((p, i) => <option key={p.label} value={i}>{p.label}</option>)}
                    </select>
                </label>
            </Module>

            <Module name="Arp" enabled={arp.enabled} onToggle={() => onChange('arp', { enabled: !arp.enabled })}>
                <label className={labelClass}>
                    Mode
                    <select value={arp.mode} onChange={(e) => onChange('arp', { mode: e.target.value as NoteFxChain['arp']['mode'] })} className={fieldClass}>
                        {ARP_MODES.map((m) => <option key={m} value={m}>{m === 'updown' ? 'up/down' : m === 'played' ? 'as played' : m}</option>)}
                    </select>
                </label>
                <label className={labelClass}>
                    Rate
                    <select value={arp.rate} onChange={(e) => onChange('arp', { rate: Number(e.target.value) })} className={fieldClass}>
                        {ARP_RATES.map((r) => <option key={r} value={r}>{RATE_LABELS[r]}</option>)}
                    </select>
                </label>
                <label className={labelClass}>
                    Octaves
                    <select value={arp.octaves} onChange={(e) => onChange('arp', { octaves: Number(e.target.value) })} className={fieldClass}>
                        {[1, 2, 3, 4].map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                </label>
                <Range label="Gate" value={arp.gate} min={0.05} max={1} step={0.05} format={pct} onChange={(v) => onChange('arp', { gate: v })} />
            </Module>

            <Module name="Ratchet" enabled={ratchet.enabled} onToggle={() => onChange('ratchet', { enabled: !ratchet.enabled })}>
                <label className={labelClass}>
                    Repeats
                    <select value={ratchet.count} onChange={(e) => onChange('ratchet', { count: Number(e.target.value) })} className={fieldClass}>
                        {[1, 2, 3, 4, 5, 6, 7, 8].map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                </label>
                <Range label="Decay" value={ratchet.decay} min={0} max={1} step={0.05} format={pct} onChange={(v) => onChange('ratchet', { decay: v })} />
                <Range label="Gate" value={ratchet.gate} min={0.05} max={1} step={0.05} format={pct} onChange={(v) => onChange('ratchet', { gate: v })} />
            </Module>

            <Module name="Euclid" enabled={euclid.enabled} onToggle={() => onChange('euclid', { enabled: !euclid.enabled })}>
                <label className={labelClass}>
                    Pulses
                    <input
                        type="number"
                        min={0}
                        max={euclid.steps}
                        value={euclid.pulses}
                        onChange={(e) => onChange('euclid', { pulses: Math.min(euclid.steps, Math.max(0, Math.round(Number(e.target.value) || 0))) })}
                        className={`${fieldClass} w-10`}
                    />
                </label>
                <label className={labelClass}>
                    of
                    <input
                        type="number"
                        min={1}
                        max={32}
                        value={euclid.steps}
                        onChange={(e) => {
                            const steps = Math.min(32, Math.max(1, Math.round(Number(e.target.value) || 1)));
                            onChange('euclid', { steps, pulses: Math.min(euclid.pulses, steps), rotation: Math.min(euclid.rotation, steps - 1) });
                        }}
                        className={`${fieldClass} w-10`}
                    />
                </label>
                <label className={labelClass}>
                    Rotate
                    <input
                        type="number"
                        min={0}
                        max={euclid.steps - 1}
                        value={euclid.rotation}
                        onChange={(e) => onChange('euclid', { rotation: Math.min(euclid.steps - 1, Math.max(0, Math.round(Number(e.target.value) || 0))) })}
                        className={`${fieldClass} w-10`}
                    />
                </label>
            </Module>

            <Module name="Humanize" enabled={humanize.enabled} onToggle={() => onChange('humanize', { enabled: !humanize.enabled })}>
                <Range label="Time" value={humanize.timing} min={0} max={0.5} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => onChange('humanize', { timing: v })} />
                <Range label="Velocity" value={humanize.velocity} min={0} max={1} step={0.05} format={pct} onChange={(v) => onChange('humanize', { velocity: v })} />
            </Module>

            <label className={`${labelClass} ml-auto`}>
                <span className="sr-only">Automate a note FX parameter</span>
                <select
                    value=""
                    onChange={(e) => {
                        if (e.target.value) onAutomate(e.target.value);
                    }}
                    className={fieldClass}
                >
                    <option value="">Automate…</option>
                    {NOTE_FX_AUTOMATION_PARAMS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
            </label>

            <button
                type="button"
                disabled={!active}
                onClick={onFreeze}
                title="Write the chain's notes into the pattern (undoable) and bypass the chain"
                className="px-2 py-1 rounded border text-[10px] font-mono uppercase tracking-wider bg-[#11151b] border-amber-600/60 text-amber-200 hover:text-white disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
            >
                Freeze to pattern
            </button>
        </section>
    );
});
