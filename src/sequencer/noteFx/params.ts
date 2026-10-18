/**
 * Note FX parameters: validation for songs off the wire, and automation.
 *
 * Automation lanes drive chain parameters through the same targets as the
 * synth knobs (`synthA` / `synthB` / `bass2` / `sampler`) with parameter ids
 * `noteFx.<module>.<param>`. They are generation-time parameters: the chain
 * reads the lane value at each source step when it builds events (live and
 * offline alike), so `AutomationScheduler` leaves them alone rather than
 * routing them to an AudioParam.
 */
import type { AutomationTarget } from '@/types';
import {
    ARP_MODES,
    ARP_RATES,
    NOTE_FX_TRACKS,
    defaultNoteFxChain,
    type NoteFxChain,
    type NoteFxModuleId,
    type NoteFxTrack,
    type SongNoteFx,
} from './types';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const num = (v: unknown, fallback: number, lo: number, hi: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? clamp(v, lo, hi) : fallback;
const int = (v: unknown, fallback: number, lo: number, hi: number): number => Math.round(num(v, fallback, lo, hi));
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});

/** Nearest allowed arp rate. */
export function snapArpRate(rate: number): number {
    let best = ARP_RATES[0];
    for (const r of ARP_RATES) if (Math.abs(r - rate) < Math.abs(best - rate)) best = r;
    return best;
}

/** A chain from untrusted song data: every field checked and clamped, defaults for the rest. */
export function normalizeNoteFxChain(raw: unknown): NoteFxChain {
    const d = defaultNoteFxChain();
    const r = obj(raw);
    const chord = obj(r.chord);
    const arp = obj(r.arp);
    const ratchet = obj(r.ratchet);
    const euclid = obj(r.euclid);
    const humanize = obj(r.humanize);
    const intervals = Array.isArray(chord.intervals)
        ? chord.intervals.filter((i): i is number => typeof i === 'number' && Number.isFinite(i)).map((i) => Math.round(clamp(i, -24, 24))).slice(0, 6)
        : d.chord.intervals;
    const euclidSteps = int(euclid.steps, d.euclid.steps, 1, 32);
    return {
        chord: { enabled: bool(chord.enabled, false), intervals },
        arp: {
            enabled: bool(arp.enabled, false),
            mode: ARP_MODES.includes(arp.mode as never) ? (arp.mode as NoteFxChain['arp']['mode']) : d.arp.mode,
            rate: snapArpRate(num(arp.rate, d.arp.rate, ARP_RATES[0], ARP_RATES[ARP_RATES.length - 1])),
            octaves: int(arp.octaves, d.arp.octaves, 1, 4),
            gate: num(arp.gate, d.arp.gate, 0.05, 1),
        },
        ratchet: {
            enabled: bool(ratchet.enabled, false),
            count: int(ratchet.count, d.ratchet.count, 1, 8),
            decay: num(ratchet.decay, d.ratchet.decay, 0, 1),
            gate: num(ratchet.gate, d.ratchet.gate, 0.05, 1),
        },
        euclid: {
            enabled: bool(euclid.enabled, false),
            steps: euclidSteps,
            pulses: int(euclid.pulses, d.euclid.pulses, 0, euclidSteps),
            rotation: int(euclid.rotation, d.euclid.rotation, 0, euclidSteps - 1),
        },
        humanize: {
            enabled: bool(humanize.enabled, false),
            timing: num(humanize.timing, d.humanize.timing, 0, 0.5),
            velocity: num(humanize.velocity, d.humanize.velocity, 0, 1),
        },
        seed: int(r.seed, d.seed, 0, 0x7fffffff),
    };
}

export function normalizeSongNoteFx(raw: unknown): SongNoteFx {
    const r = obj(raw);
    const out: SongNoteFx = {};
    for (const track of NOTE_FX_TRACKS) {
        if (r[track] !== undefined) out[track] = normalizeNoteFxChain(r[track]);
    }
    return out;
}

// ── Automation ──────────────────────────────────────────────────────────────

export const NOTE_FX_PARAM_PREFIX = 'noteFx.';

export function isNoteFxParameter(parameter: string): boolean {
    return parameter.startsWith(NOTE_FX_PARAM_PREFIX);
}

export interface NoteFxAutomationParam {
    /** Lane parameter id. */
    id: string;
    module: NoteFxModuleId;
    label: string;
    /** Apply a normalized 0–1 lane value. */
    apply: (chain: NoteFxChain, value: number) => NoteFxChain;
    /** The chain's current value, normalized — where a new lane starts. */
    read: (chain: NoteFxChain) => number;
}

const lerp = (lo: number, hi: number, v: number) => lo + (hi - lo) * clamp(v, 0, 1);
const unlerp = (lo: number, hi: number, v: number) => (hi === lo ? 0 : clamp((v - lo) / (hi - lo), 0, 1));

export const NOTE_FX_AUTOMATION_PARAMS: readonly NoteFxAutomationParam[] = [
    {
        id: 'noteFx.arp.on', module: 'arp', label: 'Arp on',
        apply: (c, v) => ({ ...c, arp: { ...c.arp, enabled: v >= 0.5 } }),
        read: (c) => (c.arp.enabled ? 1 : 0),
    },
    {
        id: 'noteFx.arp.rate', module: 'arp', label: 'Arp rate',
        apply: (c, v) => ({ ...c, arp: { ...c.arp, rate: ARP_RATES[Math.round(clamp(v, 0, 1) * (ARP_RATES.length - 1))] } }),
        read: (c) => Math.max(0, ARP_RATES.indexOf(snapArpRate(c.arp.rate))) / (ARP_RATES.length - 1),
    },
    {
        id: 'noteFx.arp.octaves', module: 'arp', label: 'Arp octaves',
        apply: (c, v) => ({ ...c, arp: { ...c.arp, octaves: Math.round(lerp(1, 4, v)) } }),
        read: (c) => unlerp(1, 4, c.arp.octaves),
    },
    {
        id: 'noteFx.arp.gate', module: 'arp', label: 'Arp gate',
        apply: (c, v) => ({ ...c, arp: { ...c.arp, gate: lerp(0.05, 1, v) } }),
        read: (c) => unlerp(0.05, 1, c.arp.gate),
    },
    {
        id: 'noteFx.ratchet.on', module: 'ratchet', label: 'Ratchet on',
        apply: (c, v) => ({ ...c, ratchet: { ...c.ratchet, enabled: v >= 0.5 } }),
        read: (c) => (c.ratchet.enabled ? 1 : 0),
    },
    {
        id: 'noteFx.ratchet.count', module: 'ratchet', label: 'Ratchet count',
        apply: (c, v) => ({ ...c, ratchet: { ...c.ratchet, count: Math.round(lerp(1, 8, v)) } }),
        read: (c) => unlerp(1, 8, c.ratchet.count),
    },
    {
        id: 'noteFx.euclid.pulses', module: 'euclid', label: 'Euclid pulses',
        apply: (c, v) => ({ ...c, euclid: { ...c.euclid, pulses: Math.round(lerp(0, c.euclid.steps, v)) } }),
        read: (c) => unlerp(0, c.euclid.steps, c.euclid.pulses),
    },
    {
        id: 'noteFx.euclid.rotation', module: 'euclid', label: 'Euclid rotation',
        apply: (c, v) => ({ ...c, euclid: { ...c.euclid, rotation: Math.round(lerp(0, c.euclid.steps - 1, v)) } }),
        read: (c) => unlerp(0, c.euclid.steps - 1, c.euclid.rotation),
    },
    {
        id: 'noteFx.humanize.timing', module: 'humanize', label: 'Humanize timing',
        apply: (c, v) => ({ ...c, humanize: { ...c.humanize, timing: lerp(0, 0.5, v) } }),
        read: (c) => unlerp(0, 0.5, c.humanize.timing),
    },
    {
        id: 'noteFx.humanize.velocity', module: 'humanize', label: 'Humanize velocity',
        apply: (c, v) => ({ ...c, humanize: { ...c.humanize, velocity: lerp(0, 1, v) } }),
        read: (c) => unlerp(0, 1, c.humanize.velocity),
    },
];

/** Normalized 0–1 lane value of `parameter` at `step`, or undefined when not automated. */
export type NoteFxParamLookup = (parameter: string, step: number) => number | undefined;

/**
 * The chain as automation sets it at `step`. Returns the input chain itself
 * when nothing is automated there, so the common case allocates nothing.
 */
export function resolveChainAtStep(chain: NoteFxChain, step: number, lookup: NoteFxParamLookup | undefined): NoteFxChain {
    if (!lookup) return chain;
    let out = chain;
    for (const param of NOTE_FX_AUTOMATION_PARAMS) {
        const value = lookup(param.id, step);
        if (value !== undefined) out = param.apply(out, value);
    }
    return out;
}

/** Automation target whose lanes drive a track's chain. */
export function noteFxAutomationTarget(track: NoteFxTrack): AutomationTarget {
    if (track === 'partA') return 'synthA';
    if (track === 'partB') return 'synthB';
    return track;
}
