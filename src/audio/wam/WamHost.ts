import { engineDegradationStore } from '../../stores/engineDegradationStore';
import { engineTelemetry } from '../../utils/engineTelemetry';
import { noteToMidi } from '../../utils/musicTheory';
import type { CompiledAudioGraph, GraphNodeId } from '../graph/types';
import { applyWamSlotsToGraph } from './applySlots';
import { getBundledPackage, isBundledPackageId, resolveAllowlistedPackage } from './catalog';
import { createBundledPlugin } from './fixtures';
import { createCommunityPlugin, type InstallOptions } from './installer';
import { hashCanonicalJson, integrityMatches } from './integrity';
import { planWam2Restore, serializeWam2SongState, type Wam2SongPayload } from './persist';
import type { Wam2Preset } from './presets';
import { collectWam2RuntimeConstraints } from './runtimeConstraints';
import type {
  Wam2NoteEvent,
  Wam2Origin,
  Wam2PackageDescriptor,
  Wam2Plugin,
  Wam2PluginInstanceState,
  Wam2SlotStatus,
  Wam2SlotTelemetry,
} from './types';
import { WAM2_DEFAULT_PERMISSIONS, WAM2_INIT_TIMEOUT_MS } from './types';
import { WamSlotPorts } from './WamSlotPorts';

interface LiveSlot {
  instance: Wam2PluginInstanceState;
  ports: WamSlotPorts;
  plugin: Wam2Plugin | null;
  status: Wam2SlotStatus;
  lastError?: string;
  /** Null means "no meter", not "free" — see Wam2SlotTelemetry.cpuPercent. */
  cpuPercent: number | null;
  latencyMs: number;
  integrityOk: boolean;
  origin: Wam2Origin;
}

export interface WamHostOptions {
  /** Injected in tests so the catalog and community packages can be served locally. */
  install?: InstallOptions;
}

function withTimeout<T>(promise: Promise<T>, ms: number, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`WAM2 init timed out after ${ms}ms`));
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('The operation was aborted.', 'AbortError'));
    };
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        reject(err);
      },
    );
  });
}

export class WamHost {
  private readonly slots = new Map<string, LiveSlot>();
  private graph: CompiledAudioGraph | null = null;
  private disposed = false;
  private readonly context: AudioContext;
  private readonly installOptions: InstallOptions;

  constructor(context: AudioContext, options: WamHostOptions = {}) {
    this.context = context;
    this.installOptions = options.install ?? {};
  }

  attachCompiledGraph(graph: CompiledAudioGraph): void {
    this.graph = graph;
  }

  getSlotPorts(slotId: string): WamSlotPorts | undefined {
    return this.slots.get(slotId)?.ports;
  }

  takesOverTrack(trackKey: 'partA' | 'partB' | 'bass2'): boolean {
    for (const slot of this.slots.values()) {
      if (
        slot.instance.placement === 'instrument' &&
        slot.instance.trackKey === trackKey &&
        slot.status === 'ready' &&
        slot.plugin
      ) {
        return true;
      }
    }
    return false;
  }

  scheduleTrackNotes(
    trackKey: 'partA' | 'partB' | 'bass2',
    notes: string | string[],
    time: number,
    durationSeconds: number,
    velocity: number,
  ): void {
    const list = Array.isArray(notes) ? notes : [notes];
    for (const slot of this.slots.values()) {
      if (slot.instance.trackKey !== trackKey || slot.status !== 'ready' || !slot.plugin?.noteOn) {
        continue;
      }
      for (const note of list) {
        const event: Wam2NoteEvent = {
          midi: noteToMidi(note),
          velocity,
          time,
          durationSeconds,
        };
        slot.plugin.noteOn(event);
      }
    }
  }

  setParam(slotId: string, paramId: string, value: number, time?: number): void {
    const slot = this.slots.get(slotId);
    if (!slot?.plugin || slot.status !== 'ready') return;
    slot.plugin.setParam(paramId, value, time);
    slot.instance.paramState[paramId] = value;
  }

  /** Descriptor of whatever is mounted in a slot — the generic editor's input. */
  getSlotDescriptor(slotId: string): Wam2PackageDescriptor | null {
    return this.slots.get(slotId)?.plugin?.descriptor ?? null;
  }

  /** Audio clock of the context this host runs on — used by E2E to prove transport is live. */
  audioContextTime(): number {
    return this.context.currentTime;
  }

  getSlotStatus(slotId: string): Wam2SlotStatus | null {
    return this.slots.get(slotId)?.status ?? null;
  }

  listSlotIds(): string[] {
    return [...this.slots.keys()];
  }

  getParam(slotId: string, paramId: string): number | null {
    const slot = this.slots.get(slotId);
    if (!slot?.plugin) return slot?.instance.paramState[paramId] ?? null;
    return slot.plugin.getParam(paramId);
  }

  /**
   * Toggle a slot's dry bypass.
   *
   * The plugin stays mounted and keeps its state — this is a monitoring control,
   * not an unload, so flipping it back does not re-run initialize(). A slot that
   * is bypassed because it *failed* is not resumable this way; use
   * {@link restartSlot}.
   */
  setBypass(slotId: string, bypass: boolean): boolean {
    const slot = this.slots.get(slotId);
    if (!slot) return false;
    slot.instance.bypass = bypass;
    if (!slot.plugin) {
      // Nothing mounted: the dry path is already the only path.
      slot.ports.failSafeBypass();
      return false;
    }
    if (bypass) {
      slot.ports.failSafeBypass();
      slot.status = 'bypassed';
    } else if (slot.instance.placement === 'instrument') {
      slot.ports.attachInstrument(slot.plugin.audioNode);
      slot.status = 'ready';
    } else {
      slot.ports.attachPlugin(slot.plugin.audioNode);
      slot.status = 'ready';
    }
    this.publishTelemetry();
    return true;
  }

  /**
   * Tear a slot down and mount it again from its saved state.
   *
   * This is the recovery path for a slot that failed or timed out: it re-runs
   * the whole verified mount, so a package that was fixed on disk (or a
   * transient init failure) can recover without reloading the page. Param state
   * and plugin state are carried across; identity is re-verified, never assumed.
   */
  async restartSlot(slotId: string): Promise<boolean> {
    const slot = this.slots.get(slotId);
    if (!slot) return false;
    const instance: Wam2PluginInstanceState = {
      ...slot.instance,
      paramState: { ...slot.instance.paramState },
      pluginState: slot.plugin?.getState() ?? slot.instance.pluginState,
    };
    const ports = slot.ports;
    slot.plugin?.dispose();
    ports.detachPlugin();
    engineDegradationStore.resolve(`wam2:${slotId}`);
    await this.mountInstance(instance, ports);
    this.publishTelemetry();
    return this.slots.get(slotId)?.status === 'ready';
  }

  /** Current param values of a slot, suitable for {@link savePreset}. */
  capturePreset(slotId: string): Wam2Preset | null {
    const slot = this.slots.get(slotId);
    if (!slot) return null;
    const descriptor = slot.plugin?.descriptor;
    const paramState: Record<string, number> = { ...slot.instance.paramState };
    if (slot.plugin && descriptor) {
      for (const param of descriptor.params) {
        paramState[param.id] = slot.plugin.getParam(param.id);
      }
    }
    return {
      packageId: slot.instance.packageId,
      version: slot.instance.version,
      paramState,
      pluginState: slot.plugin?.getState() ?? slot.instance.pluginState,
    };
  }

  /**
   * Apply a preset to a mounted slot.
   *
   * Refuses a preset saved from a different package: a "preset" that silently
   * lands on another plugin is the same substitution failure the restore path
   * exists to prevent.
   */
  applyPreset(slotId: string, preset: Wam2Preset): boolean {
    const slot = this.slots.get(slotId);
    if (!slot?.plugin || slot.instance.packageId !== preset.packageId) return false;
    if (preset.pluginState !== undefined) {
      slot.plugin.setState(preset.pluginState);
    }
    for (const [paramId, value] of Object.entries(preset.paramState)) {
      slot.plugin.setParam(paramId, value);
      slot.instance.paramState[paramId] = value;
    }
    slot.instance.pluginState = preset.pluginState;
    return true;
  }

  exportSongState(): Wam2SongPayload {
    const plugins: Wam2PluginInstanceState[] = [];
    for (const slot of this.slots.values()) {
      // Read every param the descriptor declares, not just 'gain': a community
      // package has its own set, and a song that saved only 'gain' would come
      // back with the rest silently reset to defaults.
      const paramState = { ...slot.instance.paramState };
      if (slot.plugin) {
        for (const param of slot.plugin.descriptor.params) {
          paramState[param.id] = slot.plugin.getParam(param.id);
        }
      }
      plugins.push({
        ...slot.instance,
        paramState,
        pluginState: slot.plugin?.getState() ?? slot.instance.pluginState,
      });
    }
    return serializeWam2SongState(plugins);
  }

  telemetry(): Wam2SlotTelemetry[] {
    return [...this.slots.values()].map((slot) => ({
      slotId: slot.instance.slotId,
      packageId: slot.instance.packageId,
      version: slot.instance.version,
      origin: slot.origin,
      placement: slot.instance.placement,
      status: slot.status,
      cpuPercent: this.sampleCpu(slot),
      latencyMs: slot.latencyMs,
      lastError: slot.lastError,
      isolation: 'audio-graph-slot',
      permissions: WAM2_DEFAULT_PERMISSIONS,
      offline: slot.plugin?.descriptor.offline ?? 'unsupported',
      integrityOk: slot.integrityOk,
    }));
  }

  publishTelemetry(): void {
    const slots = this.telemetry();
    engineTelemetry.recordWam2Slots(slots);
    engineTelemetry.recordWam2Constraints(collectWam2RuntimeConstraints());
    for (const slot of slots) {
      engineTelemetry.registerResolution(
        `wam2:${slot.slotId}`,
        slot.status,
        slot.lastError ?? slot.packageId,
      );
      engineTelemetry.recordLatency(`wam2:${slot.slotId}`, slot.latencyMs);
      if (slot.lastError) {
        engineTelemetry.recordError(`wam2:${slot.slotId}`, slot.lastError);
      }
    }
  }

  async restore(payload: Wam2SongPayload | undefined, portsById?: Map<GraphNodeId, WamSlotPorts>): Promise<void> {
    const plan = await planWam2Restore(payload, { fetchImpl: this.installOptions.fetchImpl });
    const ports = portsById ?? (this.graph ? collectSlotPorts(this.graph) : new Map());

    for (const entry of plan.missingDetail) {
      const missing = entry.instance;
      const slotPorts = ports.get(missing.slotId) ?? this.ensureLiveSlotPorts(missing);
      // 'missing' = we do not have this package at all; 'failed' = we have it but
      // the saved identity does not match what is installed. Both bypass; neither
      // ever loads a different plugin in its place.
      this.slots.set(missing.slotId, {
        instance: missing,
        ports: slotPorts,
        plugin: null,
        status: entry.reason === 'not-allowlisted' ? 'missing' : 'failed',
        lastError: entry.detail,
        cpuPercent: null,
        latencyMs: 0,
        integrityOk: false,
        origin: isBundledPackageId(missing.packageId) ? 'bundled' : 'community',
      });
      slotPorts.failSafeBypass();
      this.reportPlaceholder(missing.slotId, entry.detail);
    }
    for (const instance of plan.load) {
      const slotPorts = ports.get(instance.slotId) ?? this.ensureLiveSlotPorts(instance);
      await this.mountInstance(instance, slotPorts);
    }
    this.publishTelemetry();
  }

  /**
   * Per-slot DSP load, or null when nothing can measure it.
   *
   * Only a plugin that owns its own worklet can report this. The bundled
   * fixtures and hyphon.pulsar are built from native AudioNodes, which the main
   * thread cannot time individually — so they return null and the HUD shows
   * "—". Reporting 0% instead would be a fabricated measurement that reads as
   * "this slot is free".
   */
  private sampleCpu(slot: LiveSlot): number | null {
    if (slot.status !== 'ready' || !slot.plugin?.cpuLoad) return slot.cpuPercent;
    try {
      const value = slot.plugin.cpuLoad();
      slot.cpuPercent = typeof value === 'number' && Number.isFinite(value) ? value : null;
    } catch {
      slot.cpuPercent = null;
    }
    return slot.cpuPercent;
  }

  private ensureLiveSlotPorts(instance: Wam2PluginInstanceState): WamSlotPorts {
    const existing = this.slots.get(instance.slotId)?.ports;
    if (existing) return existing;
    const ports = new WamSlotPorts(this.context);
    if (this.graph) {
      try {
        this.spliceLive(instance, ports);
      } catch {
        /* graph may already include the slot from compile-time apply */
      }
    }
    return ports;
  }

  private spliceLive(instance: Wam2PluginInstanceState, ports: WamSlotPorts): void {
    if (!this.graph) return;
    if (instance.placement === 'instrument') {
      const dest = this.graph.getPort(instance.attachToNodeId).input;
      ports.output.connect(dest);
      return;
    }
    if (instance.placement === 'sendReturn') {
      const src = this.graph.getPort(instance.attachToNodeId).output;
      const fx = this.graph.getPort('masterSaturation').input;
      src.connect(ports.input);
      ports.output.connect(fx);
      return;
    }
    const fromId = instance.interceptFromNodeId;
    if (!fromId) return;
    const from = this.graph.getPort(fromId).output;
    const to = this.graph.getPort(instance.attachToNodeId).input;
    try {
      from.disconnect(to);
    } catch {
      /* mock / already disconnected */
    }
    from.connect(ports.input);
    ports.output.connect(to);
  }

  /**
   * Verify identity and construct the plugin, by origin.
   *
   * Bundled: the descriptor fingerprint is recomputed and compared, which
   * catches a tampered compiled-in catalog. Community: {@link installCommunityPackage}
   * has already hashed the real file bytes and refused to import on mismatch, so
   * reaching a constructed plugin *is* the integrity proof — the saved instance
   * hash is checked against the catalog separately in {@link planWam2Restore}.
   */
  private async createVerifiedPlugin(
    instance: Wam2PluginInstanceState,
    live: LiveSlot,
  ): Promise<Wam2Plugin> {
    const bundled = await getBundledPackage(instance.packageId);
    if (bundled) {
      live.origin = 'bundled';
      const fingerprint = {
        id: bundled.id,
        kind: bundled.kind,
        license: bundled.license,
        params: bundled.params.map((p) => p.id),
        title: bundled.title,
        vendor: bundled.vendor,
        version: bundled.version,
      };
      const hash = await hashCanonicalJson(fingerprint);
      live.integrityOk = integrityMatches(bundled.integrity, hash);
      if (!live.integrityOk) {
        throw new Error('package integrity check failed');
      }
      return createBundledPlugin(instance.packageId);
    }

    const descriptor = await resolveAllowlistedPackage(instance.packageId, this.installOptions.fetchImpl);
    if (!descriptor) {
      throw new Error(`not allowlisted: ${instance.packageId}`);
    }
    live.origin = 'community';
    const plugin = await createCommunityPlugin(instance.packageId, this.installOptions);
    live.integrityOk = true;
    return plugin;
  }

  async mountInstance(instance: Wam2PluginInstanceState, ports: WamSlotPorts): Promise<void> {
    const started = typeof performance !== 'undefined' ? performance.now() : 0;
    const controller = new AbortController();
    const live: LiveSlot = {
      instance,
      ports,
      plugin: null,
      status: 'loading',
      cpuPercent: null,
      latencyMs: 0,
      integrityOk: false,
      origin: isBundledPackageId(instance.packageId) ? 'bundled' : 'community',
    };
    this.slots.set(instance.slotId, live);

    try {
      const plugin = await this.createVerifiedPlugin(instance, live);
      await withTimeout(plugin.initialize(this.context, controller.signal), WAM2_INIT_TIMEOUT_MS, controller.signal);

      if (instance.pluginState !== undefined) {
        plugin.setState(instance.pluginState);
      }
      for (const [paramId, value] of Object.entries(instance.paramState)) {
        plugin.setParam(paramId, value);
      }
      if (instance.bypass) {
        ports.failSafeBypass();
        live.status = 'bypassed';
      } else if (instance.placement === 'instrument') {
        ports.attachInstrument(plugin.audioNode);
        live.status = 'ready';
      } else {
        ports.attachPlugin(plugin.audioNode);
        live.status = 'ready';
      }
      live.plugin = plugin;
      live.latencyMs = (typeof performance !== 'undefined' ? performance.now() : started) - started;
      engineDegradationStore.resolve(`wam2:${instance.slotId}`);
    } catch (err) {
      controller.abort();
      const message = err instanceof Error ? err.message : String(err);
      const timedOut = message.includes('timed out');
      live.status = timedOut ? 'timeout' : 'failed';
      live.lastError = message;
      live.plugin = null;
      ports.failSafeBypass();
      this.reportPlaceholder(instance.slotId, message);
    }
  }

  private reportPlaceholder(slotId: string, reason: string): void {
    engineDegradationStore.report({
      id: `wam2:${slotId}`,
      subsystem: 'wam2',
      category: 'audio',
      message: 'WAM2 slot bypassed',
      reason,
      status: 'active',
      activeBackend: 'bypass-placeholder',
      requestedBackend: 'wam2-plugin',
      retryable: false,
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const slot of this.slots.values()) {
      slot.plugin?.dispose();
      slot.ports.dispose();
    }
    this.slots.clear();
    this.graph = null;
  }
}

let activeHost: WamHost | null = null;

export function getWamHost(): WamHost | null {
  return activeHost;
}

export function setWamHost(host: WamHost | null): void {
  if (activeHost && activeHost !== host) {
    activeHost.dispose();
  }
  activeHost = host;
}

export function collectSlotPorts(graph: CompiledAudioGraph): Map<GraphNodeId, WamSlotPorts> {
  const out = new Map<GraphNodeId, WamSlotPorts>();
  for (const [id, port] of graph.ports) {
    if (port.wamSlot) {
      out.set(id, port.wamSlot);
    }
  }
  return out;
}

export { applyWamSlotsToGraph };
