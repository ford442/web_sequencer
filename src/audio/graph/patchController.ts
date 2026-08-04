/**
 * Live patch controller — the bridge between the declarative config the patch
 * bay edits and the Web Audio nodes that are already running.
 *
 * Edge edits (connect, disconnect, send level) are applied incrementally to the
 * live graph: `connect`/`disconnect` are cheap and glitch-free, so the user
 * hears a new send immediately without a rebuild. Node add/remove changes the
 * node set, which cannot be patched safely while audio is flowing — those are
 * staged into the config and reported as `requiresRebuild`, so the caller can
 * decide when to recompile (today: next engine start).
 *
 * The controller is the single writer of the config. Everything else — the UI,
 * autosave — reads through it.
 */

import { compileAudioGraph } from './compileGraph';
import {
    addConnection,
    addNode,
    edgeKey,
    findEdge,
    removeConnection,
    removeNode,
    setConnectionGain,
    setNodePosition,
    validateGraph,
    type GraphValidationIssue,
} from './graphOps';
import { graphsEqual, serializeAudioGraph, type SerializedAudioGraph } from './graphSerialization';
import type {
    AudioGraphConfig,
    CompiledAudioGraph,
    GraphNodeId,
    GraphNodeSpec,
} from './types';

export interface PatchEditOutcome {
    ok: boolean;
    /** Why the edit was refused, for display next to the offending cable. */
    rejected?: GraphValidationIssue;
    /** True when the change needs an engine rebuild to be heard. */
    requiresRebuild?: boolean;
}

export type PatchListener = (config: AudioGraphConfig) => void;

export class PatchController {
    private config: AudioGraphConfig;
    private readonly stockPreset: AudioGraphConfig;
    private compiled: CompiledAudioGraph | null;
    private context: AudioContext | null;
    private readonly listeners = new Set<PatchListener>();
    /** Send gains created after compilation, keyed like `CompiledAudioGraph.sendGains`. */
    private readonly liveSends = new Map<string, GainNode>();
    private pendingRebuild = false;

    constructor(config: AudioGraphConfig, stockPreset: AudioGraphConfig = config) {
        this.config = config;
        this.stockPreset = stockPreset;
        this.compiled = null;
        this.context = null;
    }

    /** Attach the controller to a compiled, running graph. */
    attach(context: AudioContext, compiled: CompiledAudioGraph): void {
        this.context = context;
        this.compiled = compiled;
        this.liveSends.clear();
        for (const [key, node] of compiled.sendGains) this.liveSends.set(key, node);
        this.pendingRebuild = false;
    }

    /** Detach on engine dispose so stale nodes are never reconnected. */
    detach(): void {
        this.context = null;
        this.compiled = null;
        this.liveSends.clear();
    }

    getConfig(): AudioGraphConfig {
        return this.config;
    }

    /** True when the patch differs from the preset it started from. */
    isModified(): boolean {
        return !graphsEqual(this.config, this.stockPreset);
    }

    /** True when edits are staged that only a rebuild will make audible. */
    needsRebuild(): boolean {
        return this.pendingRebuild;
    }

    subscribe(listener: PatchListener): () => void {
        this.listeners.add(listener);
        listener(this.config);
        return () => {
            this.listeners.delete(listener);
        };
    }

    private commit(config: AudioGraphConfig): void {
        this.config = config;
        for (const listener of this.listeners) listener(config);
    }

    private liveNode(id: GraphNodeId): AudioNode | undefined {
        if (!this.compiled) return undefined;
        if (id === 'destination') return this.context?.destination;
        return this.compiled.nodes.get(id);
    }

    /**
     * Connect two nodes, optionally through a send level.
     *
     * The config is validated first (cycles are refused), then the live graph is
     * patched. If either node is missing from the running graph — a user node
     * added since the last compile — the edit is staged for the next rebuild
     * rather than silently doing nothing.
     */
    connect(from: GraphNodeId, to: GraphNodeId, gain?: number): PatchEditOutcome {
        const result = addConnection(this.config, from, to, gain === undefined ? {} : { gain });
        if (result.rejected) return { ok: false, rejected: result.rejected };

        const source = this.liveNode(from);
        const target = this.liveNode(to);
        // Flags are set before commit(): subscribers read `needsRebuild()` in
        // their callback, so it has to be final by the time they run.
        if (!source || !target) {
            this.pendingRebuild = true;
            this.commit(result.config);
            return { ok: true, requiresRebuild: true };
        }
        this.commit(result.config);

        if (gain !== undefined && gain !== 1 && this.context) {
            const send = this.context.createGain();
            send.gain.setValueAtTime(gain, this.context.currentTime);
            source.connect(send);
            send.connect(target);
            this.liveSends.set(edgeKey(from, to), send);
        } else {
            source.connect(target);
        }
        return { ok: true };
    }

    /** Disconnect two nodes, tearing down the send gain if there was one. */
    disconnect(from: GraphNodeId, to: GraphNodeId): PatchEditOutcome {
        const existing = findEdge(this.config, from, to);
        if (!existing) {
            return {
                ok: false,
                rejected: {
                    code: 'unknown-node',
                    message: `No connection ${from} → ${to}`,
                    nodes: [from, to],
                },
            };
        }
        this.commit(removeConnection(this.config, from, to));

        const source = this.liveNode(from);
        const target = this.liveNode(to);
        const key = edgeKey(from, to);
        const send = this.liveSends.get(key);

        try {
            if (send) {
                source?.disconnect(send);
                send.disconnect();
                this.liveSends.delete(key);
            } else if (source && target) {
                source.disconnect(target);
            }
        } catch {
            // Web Audio throws when the pair was never connected (e.g. the edit
            // was staged for a rebuild). The config is already correct.
            this.pendingRebuild = true;
        }
        return { ok: true };
    }

    /**
     * Ride a send level. When the edge had no gain node (level 1), changing it
     * needs the node inserted, which cannot be done without briefly rewiring —
     * so that case is staged for the next rebuild.
     */
    setSendLevel(from: GraphNodeId, to: GraphNodeId, gain: number): PatchEditOutcome {
        const existing = findEdge(this.config, from, to);
        if (!existing) {
            return {
                ok: false,
                rejected: {
                    code: 'unknown-node',
                    message: `No connection ${from} → ${to}`,
                    nodes: [from, to],
                },
            };
        }
        const safe = Number.isFinite(gain) ? Math.max(0, gain) : 1;
        const send = this.liveSends.get(edgeKey(from, to));
        if (!send || !this.context) this.pendingRebuild = true;
        this.commit(setConnectionGain(this.config, from, to, safe));

        if (send && this.context) {
            // Short ramp rather than a step: a fader jump on a live send clicks.
            const now = this.context.currentTime;
            send.gain.cancelScheduledValues(now);
            send.gain.setValueAtTime(send.gain.value, now);
            send.gain.linearRampToValueAtTime(safe, now + 0.02);
            return { ok: true };
        }

        return { ok: true, requiresRebuild: true };
    }

    /** Add a node. Always requires a rebuild before it processes audio. */
    addNode(node: GraphNodeSpec): PatchEditOutcome {
        const result = addNode(this.config, node);
        if (result.rejected) return { ok: false, rejected: result.rejected };
        this.pendingRebuild = true;
        this.commit(result.config);
        return { ok: true, requiresRebuild: true };
    }

    /** Remove a user node and its cables. Fixed preset nodes are refused. */
    removeNode(id: GraphNodeId): PatchEditOutcome {
        const result = removeNode(this.config, id);
        if (result.rejected) return { ok: false, rejected: result.rejected };
        this.pendingRebuild = true;
        this.commit(result.config);
        return { ok: true, requiresRebuild: true };
    }

    /** Cosmetic move in the editor canvas. */
    moveNode(id: GraphNodeId, position: { x: number; y: number }): void {
        this.commit(setNodePosition(this.config, id, position));
    }

    /** Replace the whole patch (preset switch, project load). Needs a rebuild. */
    replaceConfig(config: AudioGraphConfig): PatchEditOutcome {
        const validation = validateGraph(config);
        if (!validation.valid) {
            return { ok: false, rejected: validation.issues[0] };
        }
        this.pendingRebuild = true;
        this.commit(config);
        return { ok: true, requiresRebuild: true };
    }

    /** Snapshot for the song payload. */
    serialize(): SerializedAudioGraph {
        return serializeAudioGraph(this.config, this.isModified());
    }

    /**
     * Compile the current config against a context, e.g. after a rebuild.
     * Attaches the result so subsequent edits patch the new graph.
     */
    compile(context: AudioContext, options?: Parameters<typeof compileAudioGraph>[2]): CompiledAudioGraph {
        const compiled = compileAudioGraph(context, this.config, options);
        this.attach(context, compiled);
        return compiled;
    }
}
