/**
 * The offline half of the patch bay (#1233).
 *
 * One function builds the `OfflineAudioContext` that freeze, stem export, XM
 * bounce and the AI song preview all render through. It compiles the *live*
 * `AudioGraphConfig` with `compileAudioGraph` — the same compiler the running
 * engine uses (#1038) — so "what you hear is what you bounce" holds by
 * construction rather than by two code paths agreeing to be similar.
 *
 * What it owns:
 *
 * - **Sample rate.** Resolved from the user policy (#1136), or from the rate
 *   the live `AudioContext` actually came up with when the policy says native.
 * - **Master loudness.** The limiter/meter worklet cannot be instantiated in a
 *   render that has already finished, so the identical DSP runs over the
 *   rendered mix at the same point in the chain (#1095).
 * - **WAM2 slots.** Bundled fixtures declare `offline: 'native'` and are
 *   mounted into the offline context. Everything else is `offline:
 *   'unsupported'` per ADR 0001: the slot is bypassed, the mix continues, and
 *   the reason is reported. No first-party engine is ever substituted.
 */

import { compileAudioGraph, type CompileGraphOptions } from '../graph/compileGraph';
import { CLASSIC_ELECTRIBE_GRAPH } from '../graph/defaultElectribeGraph';
import { getActivePatchController } from '../graph/patchRegistry';
import type { AudioGraphConfig, CompiledAudioGraph, GraphNodeId } from '../graph/types';
import { applyMasterLoudnessOffline, type MasterLoudnessRenderResult } from '../loudness/offline';
import { loadLimiterSettings } from '../loudness/settings';
import type { LimiterSettings } from '../loudness/types';
import { resolveAllowlistedPackage } from '../wam/catalog';
import { createBundledPlugin } from '../wam/fixtures';
import { applyWamSlotsToGraph } from '../wam/applySlots';
import { getWamHost } from '../wam/WamHost';
import type { WamSlotPorts } from '../wam/WamSlotPorts';
import type {
    Wam2OfflineSupport,
    Wam2PackageDescriptor,
    Wam2Placement,
    Wam2Plugin,
    Wam2PluginInstanceState,
} from '../wam/types';
import type { Wam2SongPayload } from '../wam/persist';
import {
    resolveExportSampleRate,
    getStoredSampleRatePref,
    type SampleRatePref,
} from '../../utils/audioContextPolicy';

/** Graph node factories that carry a WAM2 plugin. */
const WAM_FACTORIES = new Set([
    'wamInstrumentSlot',
    'wamTrackInsert',
    'wamMasterInsert',
    'wamSendReturn',
]);

/** Why a slot did not render, in words a badge can show verbatim. */
export type OfflineSlotSkipReason =
    | 'offline-unsupported'
    | 'not-allowlisted'
    | 'catalog-unavailable'
    | 'mount-failed'
    | 'no-plugin-in-slot';

export interface OfflineGraphSlotReport {
    /** Graph node id, which for a WAM2 slot is also its slot id. */
    nodeId: GraphNodeId;
    packageId: string | null;
    placement: Wam2Placement | null;
    offline: Wam2OfflineSupport;
    status: 'rendered' | 'bypassed';
    /** Present whenever `status` is `bypassed`. */
    reason?: OfflineSlotSkipReason;
    detail?: string;
}

export interface OfflineGraphReport {
    /** Rate the render actually runs at. */
    sampleRate: number;
    sampleRatePref: SampleRatePref;
    /** Live `AudioContext.sampleRate` the caller recorded, when there was one. */
    liveSampleRate: number | null;
    patchId: string;
    patchName: string;
    /** Every WAM2 slot in the patch, rendered or bypassed. */
    slots: OfflineGraphSlotReport[];
    /** Loudness readings, filled in by `render()`. */
    loudness: MasterLoudnessRenderResult | null;
}

export interface CompiledOfflineGraph {
    context: OfflineAudioContext;
    graph: CompiledAudioGraph;
    report: OfflineGraphReport;
    /** Where instruments enter the master FX chain (`masterFxInput`). */
    input: AudioNode;
    /** Post-FX entry used by drums / ambiance live (`masterDryInput`). */
    dryInput: AudioNode;
    /** WAM2 plugins actually mounted offline, so a caller can schedule notes. */
    slotPlugins: ReadonlyMap<GraphNodeId, Wam2Plugin>;
    /** Render, then run the master loudness stage. Fills `report.loudness`. */
    render: () => Promise<AudioBuffer>;
}

export interface OfflineGraphLoudnessOptions {
    /** Override the persisted live limiter settings (tests, export presets). */
    settings?: Partial<LimiterSettings>;
    /** Skip the master loudness stage entirely (dry stem renders). */
    enabled?: boolean;
}

export interface CompileOfflineGraphOptions {
    /** Render length. Rounded up to whole frames. */
    durationSeconds: number;
    /**
     * Patch to bounce. Defaults to the live patch from the patch registry, and
     * to Classic Electribe when the engine is not running.
     */
    patch?: AudioGraphConfig | null;
    /** Explicit rate; when omitted the user policy decides. */
    sampleRate?: number;
    sampleRatePref?: SampleRatePref;
    /** `AudioContext.sampleRate` of the running engine, for the `native` pref. */
    liveSampleRate?: number | null;
    /** Defaults to 2 — every consumer of this compiler bounces stereo. */
    channels?: number;
    /**
     * WAM2 slot state to reproduce offline. Defaults to the live host's song
     * state, so a freeze carries the inserts the user is hearing.
     */
    wam2?: Wam2SongPayload | null;
    loudness?: OfflineGraphLoudnessOptions;
    /** Passed through to the shared compiler (reverb impulses, validation). */
    compile?: Pick<CompileGraphOptions, 'createReverbImpulse' | 'validate' | 'useStereoPanner'>;
    /** Injected by tests; production constructs a real `OfflineAudioContext`. */
    contextFactory?: (
        channels: number,
        length: number,
        sampleRate: number,
    ) => OfflineAudioContext;
    /** Injected by tests; production resolves through the WAM2 allowlist. */
    resolveDescriptor?: (packageId: string) => Promise<Wam2PackageDescriptor | null | undefined>;
}

function defaultContextFactory(
    channels: number,
    length: number,
    sampleRate: number,
): OfflineAudioContext {
    if (typeof OfflineAudioContext === 'undefined') {
        throw new Error('OfflineAudioContext is not available in this environment');
    }
    return new OfflineAudioContext(channels, length, sampleRate);
}

function channelsOf(buffer: AudioBuffer): Float32Array[] {
    const channels: Float32Array[] = [];
    for (let ch = 0; ch < buffer.numberOfChannels; ch += 1) {
        channels.push(buffer.getChannelData(ch));
    }
    return channels;
}

/** The live patch, or the stock preset when the engine has not started. */
function resolveLivePatch(): AudioGraphConfig {
    try {
        return getActivePatchController()?.getConfig() ?? CLASSIC_ELECTRIBE_GRAPH;
    } catch {
        return CLASSIC_ELECTRIBE_GRAPH;
    }
}

function resolveLiveWam2State(): Wam2SongPayload | null {
    try {
        return getWamHost()?.exportSongState() ?? null;
    } catch {
        return null;
    }
}

/**
 * Splice slot nodes the patch does not already carry.
 *
 * The live patch usually holds them already (the host edits the same config),
 * but a patch loaded from a preset does not, and a bounce that silently
 * dropped an insert would be exactly the divergence this module exists to
 * remove.
 */
function withWamSlots(
    patch: AudioGraphConfig,
    payload: Wam2SongPayload | null,
): AudioGraphConfig {
    const instances = payload?.plugins ?? [];
    if (instances.length === 0) return patch;
    const missing = instances.filter(
        (instance) => !patch.nodes.some((node) => node.id === instance.slotId),
    );
    if (missing.length === 0) return patch;
    return applyWamSlotsToGraph(patch, missing);
}

async function describeSlot(
    packageId: string,
    resolveDescriptor: (id: string) => Promise<Wam2PackageDescriptor | null | undefined>,
): Promise<
    | { descriptor: Wam2PackageDescriptor }
    | { descriptor: null; reason: OfflineSlotSkipReason; detail: string }
> {
    try {
        const descriptor = await resolveDescriptor(packageId);
        if (!descriptor) {
            return {
                descriptor: null,
                reason: 'not-allowlisted',
                detail: `${packageId} is not in the WAM2 allowlist`,
            };
        }
        return { descriptor };
    } catch (error) {
        return {
            descriptor: null,
            reason: 'catalog-unavailable',
            detail: error instanceof Error ? error.message : String(error),
        };
    }
}

/**
 * Mount a first-party fixture into the offline context.
 *
 * The `Wam2Plugin` contract predates offline rendering and types its context as
 * `AudioContext`; a fixture only calls factory methods every `BaseAudioContext`
 * has. The cast is confined to this one call — nothing else here treats the
 * offline context as a live one.
 */
async function mountNativeSlot(
    context: OfflineAudioContext,
    ports: WamSlotPorts,
    instance: Wam2PluginInstanceState,
    descriptor: Wam2PackageDescriptor,
): Promise<Wam2Plugin> {
    const plugin = await createBundledPlugin(descriptor.id);
    await plugin.initialize(context as unknown as AudioContext);
    if (instance.placement === 'instrument') {
        ports.attachInstrument(plugin.audioNode);
    } else {
        ports.attachPlugin(plugin.audioNode);
    }
    for (const [paramId, value] of Object.entries(instance.paramState ?? {})) {
        plugin.setParam(paramId, value);
    }
    if (instance.pluginState !== undefined) {
        plugin.setState(instance.pluginState);
    }
    if (instance.bypass) ports.failSafeBypass();
    return plugin;
}

/**
 * Reproduce the live WAM2 slots in the offline graph.
 *
 * ADR 0001 is the whole rule here: a package is replayable offline only when it
 * says so *and* it is first-party. Anything else is bypassed with a reason —
 * never replaced by a stand-in that would make the bounce a lie.
 */
async function applyOfflineWamSlots(
    context: OfflineAudioContext,
    graph: CompiledAudioGraph,
    patch: AudioGraphConfig,
    payload: Wam2SongPayload | null,
    resolveDescriptor: (id: string) => Promise<Wam2PackageDescriptor | null | undefined>,
): Promise<{ reports: OfflineGraphSlotReport[]; plugins: Map<GraphNodeId, Wam2Plugin> }> {
    const reports: OfflineGraphSlotReport[] = [];
    const plugins = new Map<GraphNodeId, Wam2Plugin>();
    const instances = new Map<string, Wam2PluginInstanceState>();
    for (const instance of payload?.plugins ?? []) {
        instances.set(instance.slotId, instance);
    }

    for (const node of patch.nodes) {
        if (!WAM_FACTORIES.has(node.factory)) continue;
        const ports = graph.ports.get(node.id)?.wamSlot;
        const instance = instances.get(node.id);

        if (!instance) {
            ports?.failSafeBypass();
            reports.push({
                nodeId: node.id,
                packageId: null,
                placement: null,
                offline: 'unsupported',
                status: 'bypassed',
                reason: 'no-plugin-in-slot',
                detail: 'slot is empty in the saved WAM2 state',
            });
            continue;
        }

        const resolved = await describeSlot(instance.packageId, resolveDescriptor);
        if (!resolved.descriptor) {
            ports?.failSafeBypass();
            reports.push({
                nodeId: node.id,
                packageId: instance.packageId,
                placement: instance.placement,
                offline: 'unsupported',
                status: 'bypassed',
                reason: resolved.reason,
                detail: resolved.detail,
            });
            continue;
        }

        const descriptor = resolved.descriptor;
        // Belt and braces: `descriptorFromCatalogEntry` already refuses to grant
        // `native` to a community package, and this refuses to mount one even if
        // that ever regressed.
        const replayable = descriptor.offline === 'native' && descriptor.origin === 'bundled';
        if (!replayable || !ports) {
            ports?.failSafeBypass();
            reports.push({
                nodeId: node.id,
                packageId: instance.packageId,
                placement: instance.placement,
                offline: descriptor.offline,
                status: 'bypassed',
                reason: 'offline-unsupported',
                detail: `${descriptor.title} (${descriptor.id}) cannot be rendered offline`,
            });
            continue;
        }

        try {
            plugins.set(node.id, await mountNativeSlot(context, ports, instance, descriptor));
            reports.push({
                nodeId: node.id,
                packageId: instance.packageId,
                placement: instance.placement,
                offline: 'native',
                status: 'rendered',
            });
        } catch (error) {
            ports.failSafeBypass();
            reports.push({
                nodeId: node.id,
                packageId: instance.packageId,
                placement: instance.placement,
                offline: descriptor.offline,
                status: 'bypassed',
                reason: 'mount-failed',
                detail: error instanceof Error ? error.message : String(error),
            });
        }
    }

    return { reports, plugins };
}

/**
 * Build the offline render context for the current patch.
 *
 * Nothing is scheduled and nothing is rendered: the caller connects its sources
 * to `input` (or `dryInput`) and then awaits `render()`.
 */
export async function compileOfflineGraph(
    options: CompileOfflineGraphOptions,
): Promise<CompiledOfflineGraph> {
    const sampleRatePref = options.sampleRatePref ?? getStoredSampleRatePref();
    const liveSampleRate = options.liveSampleRate ?? null;
    const sampleRate =
        options.sampleRate ?? resolveExportSampleRate(sampleRatePref, liveSampleRate);
    const channels = options.channels ?? 2;
    const length = Math.max(1, Math.ceil(options.durationSeconds * sampleRate));

    const basePatch = options.patch ?? resolveLivePatch();
    const wam2 = options.wam2 !== undefined ? options.wam2 : resolveLiveWam2State();
    const patch = withWamSlots(basePatch, wam2);

    const context = (options.contextFactory ?? defaultContextFactory)(
        channels,
        length,
        sampleRate,
    );

    const graph = compileAudioGraph(context, patch, {
        ...options.compile,
        // The limiter is an AudioWorklet; offline it runs as DSP over the
        // rendered mix instead (see `render`), at the same point in the chain.
        createMasterLimiterNode: () => null,
    });

    const { reports, plugins } = await applyOfflineWamSlots(
        context,
        graph,
        patch,
        wam2,
        options.resolveDescriptor ?? ((id) => resolveAllowlistedPackage(id)),
    );

    const report: OfflineGraphReport = {
        sampleRate,
        sampleRatePref,
        liveSampleRate,
        patchId: patch.id,
        patchName: patch.name,
        slots: reports,
        loudness: null,
    };

    const input = graph.getRoleNode('masterFxInput') ?? graph.nodes.get('masterSaturation');
    if (!input) {
        throw new Error(
            `Offline graph "${patch.id}" has no masterFxInput role — nothing can be bounced into it`,
        );
    }
    const dryInput = graph.getRoleNode('masterDryInput') ?? input;

    const render = async (): Promise<AudioBuffer> => {
        const rendered = await context.startRendering();
        if (options.loudness?.enabled === false) return rendered;
        report.loudness = applyMasterLoudnessOffline(
            channelsOf(rendered),
            rendered.sampleRate ?? sampleRate,
            options.loudness?.settings ?? loadLimiterSettings(),
        );
        return rendered;
    };

    return { context, graph, report, input, dryInput, slotPlugins: plugins, render };
}

export interface OfflineGraphRenderResult {
    buffer: AudioBuffer;
    report: OfflineGraphReport;
}

export interface RenderThroughOfflineGraphOptions extends CompileOfflineGraphOptions {
    /**
     * Schedule the sources. Called after the graph is compiled and before
     * rendering starts; `input` is the master FX entry point.
     */
    schedule: (compiled: CompiledOfflineGraph) => void | Promise<void>;
}

/** Compile, schedule, render — the call every consumer of this module makes. */
export async function renderThroughOfflineGraph(
    options: RenderThroughOfflineGraphOptions,
): Promise<OfflineGraphRenderResult> {
    const { schedule, ...compileOptions } = options;
    const compiled = await compileOfflineGraph(compileOptions);
    await schedule(compiled);
    const buffer = await compiled.render();
    return { buffer, report: compiled.report };
}

export interface BounceBuffersOptions extends CompileOfflineGraphOptions {
    /** Source buffers, all started at time 0 on the master FX input. */
    buffers: readonly AudioBuffer[];
    /** Start each source at this offset instead of 0. */
    startTime?: number;
}

/**
 * Bounce already-rendered per-track buffers through the live patch's master
 * chain — how stem export builds its master stem and how a track freeze keeps
 * the master FX it was auditioned with.
 */
export async function bounceBuffersThroughOfflineGraph(
    options: BounceBuffersOptions,
): Promise<OfflineGraphRenderResult> {
    const { buffers, startTime = 0, ...rest } = options;
    return renderThroughOfflineGraph({
        ...rest,
        schedule: ({ context, input }) => {
            for (const buffer of buffers) {
                const source = context.createBufferSource();
                source.buffer = buffer;
                source.connect(input);
                source.start(startTime);
            }
        },
    });
}
