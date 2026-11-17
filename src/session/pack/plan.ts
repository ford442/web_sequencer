/**
 * Turning a validated pack into a change to the live song — computed, not
 * applied. `planPackLoad` returns the session document, the merged pattern
 * storage and the instrument settings the load would produce; the caller sets
 * them (or doesn't). Pure: the same pack and storage always give the same plan.
 *
 * Two collisions are handled here:
 *   - pack ids (`resolvePackId`): an imported pack never takes the id of a
 *     starter or of an earlier import — it gets a stable numeric suffix;
 *   - pattern slots (`policy`): a pack slot that would replace a different,
 *     non-empty pattern is either moved to a free slot (`relocate`, which
 *     also repoints the clips and scenes that name it) or written over it
 *     (`overwrite`, what the starter packs have always done).
 */

import { TRACK_KEYS } from '@/constants';
import type { TrackKey } from '@/constants/appDefaults';
import type { PartSequence } from '@/types';
import { createEmptyTrackStorage, type TrackStorageMap } from '@/utils/trackStorageUtils';
import { hasAnyNotes } from '../migrate';
import { SESSION_TRACK_LABELS, type SessionDocument } from '../types';
import { PACK_LIMITS, type PackInstruments, type SessionPack } from './format';

export type SlotCollisionPolicy = 'overwrite' | 'relocate';

type Slot = PartSequence | PartSequence[] | null;

export interface SlotRef {
  track: TrackKey;
  slot: number;
}

export interface PackLoadPlan {
  session: SessionDocument;
  trackStorage: TrackStorageMap;
  instruments: PackInstruments | undefined;
  /** Slots whose different, non-empty pattern the pack replaces (policy `overwrite`). */
  overwritten: SlotRef[];
  /** Pack slots that landed in a free slot instead of their own (policy `relocate`). */
  relocated: Array<SlotRef & { to: number }>;
}

export type PackLoadPlanResult =
  | { ok: true; plan: PackLoadPlan }
  | { ok: false; error: string };

/** Pack slots that would replace a different, non-empty pattern in `current`. */
export function findSlotCollisions(pack: Pick<SessionPack, 'trackStorage'>, current: TrackStorageMap): SlotRef[] {
  const out: SlotRef[] = [];
  for (const track of TRACK_KEYS) {
    pack.trackStorage[track].forEach((incoming, slot) => {
      if (incoming != null && collides(incoming, current[track][slot])) out.push({ track, slot });
    });
  }
  return out;
}

const sameSlot = (a: Slot, b: Slot) => JSON.stringify(a) === JSON.stringify(b);
const occupied = (slot: Slot | undefined): slot is NonNullable<Slot> => slot != null && hasAnyNotes(slot);
/** Writing `incoming` over `existing` loses something: `existing` has notes and is not already `incoming`. */
const collides = (incoming: Slot, existing: Slot | undefined) => occupied(existing) && !sameSlot(incoming, existing);

/** `id` if free, else `id-2`, `id-3`, … — the first suffix not taken. Stays within the id length limit. */
export function resolvePackId(id: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  if (!used.has(id)) return id;
  for (let n = 2; ; n++) {
    const suffix = `-${n}`;
    const candidate = `${id.slice(0, PACK_LIMITS.maxIdLength - suffix.length).replace(/-+$/, '')}${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
}

/** Where each colliding slot goes: its own index, or the lowest free one on the same track. */
function relocateTrack(
  track: TrackKey,
  incoming: Slot[],
  existing: Slot[],
): { target: Map<number, number>; error?: string } {
  const target = new Map<number, number>();
  const taken = new Set<number>();
  const pending: number[] = [];
  incoming.forEach((slot, i) => {
    if (slot == null) return;
    if (collides(slot, existing[i])) pending.push(i);
    else {
      target.set(i, i);
      taken.add(i);
    }
  });
  for (const from of pending) {
    let to = 0;
    while (to < PACK_LIMITS.maxSlotsPerTrack && (taken.has(to) || occupied(existing[to]) || incoming[to] != null)) to++;
    if (to >= PACK_LIMITS.maxSlotsPerTrack) {
      return { target, error: `${SESSION_TRACK_LABELS[track]} has no free pattern slot left for "${from + 1}"; clear a slot or load the pack with "overwrite".` };
    }
    target.set(from, to);
    taken.add(to);
  }
  return { target };
}

function repointClips(session: SessionDocument, moves: Map<string, number>): SessionDocument {
  if (moves.size === 0) return session;
  const next = structuredClone(session);
  const ids = new Set(TRACK_KEYS.flatMap((t) => next.columns[t].clips.map((c) => c.id)));
  const renamed = new Map<string, string>();
  for (const track of TRACK_KEYS) {
    for (const clip of next.columns[track].clips) {
      const to = moves.get(`${track}:${clip.slotIndex}`);
      if (to === undefined) continue;
      // Ids follow the `c:<track>:<slot>` convention; a clash gets an `:r<n>` suffix.
      let id = `c:${track}:${to}`;
      for (let n = 1; ids.has(id) && id !== clip.id; n++) id = `c:${track}:${to}:r${n}`;
      ids.add(id);
      renamed.set(clip.id, id);
      clip.slotIndex = to;
      clip.id = id;
    }
  }
  for (const scene of next.scenes) {
    for (const track of TRACK_KEYS) {
      const id = scene.clipIds[track];
      if (id != null && renamed.has(id)) scene.clipIds[track] = renamed.get(id);
    }
  }
  return next;
}

export function planPackLoad(
  pack: SessionPack,
  current: TrackStorageMap,
  policy: SlotCollisionPolicy,
): PackLoadPlanResult {
  const trackStorage = createEmptyTrackStorage();
  const overwritten: SlotRef[] = [];
  const relocated: PackLoadPlan['relocated'] = [];
  const moves = new Map<string, number>();

  for (const track of TRACK_KEYS) {
    trackStorage[track] = current[track].slice();
    const incoming = pack.trackStorage[track];
    if (policy === 'overwrite') {
      incoming.forEach((slot, i) => {
        if (slot == null) return;
        if (collides(slot, current[track][i])) overwritten.push({ track, slot: i });
        trackStorage[track][i] = slot;
      });
      continue;
    }
    const { target, error } = relocateTrack(track, incoming, current[track]);
    if (error) return { ok: false, error };
    for (const [from, to] of target) {
      trackStorage[track][to] = incoming[from];
      if (from !== to) {
        relocated.push({ track, slot: from, to });
        moves.set(`${track}:${from}`, to);
      }
    }
  }

  return {
    ok: true,
    plan: {
      session: repointClips(pack.session, moves),
      trackStorage,
      instruments: pack.instruments,
      overwritten,
      relocated,
    },
  };
}
