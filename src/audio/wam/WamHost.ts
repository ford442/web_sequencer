import { engineDegradationStore } from '../../stores/engineDegradationStore';
import { engineTelemetry } from '../../utils/engineTelemetry';
import { noteToMidi } from '../../utils/musicTheory';
import type { CompiledAudioGraph, GraphNodeId } from '../graph/types';
import { applyWamSlotsToGraph } from './applySlots';
import { getBundledPackage, isAllowlistedPackageId } from './catalog';
import { createBundledPlugin } from './fixtures';
import { hashCanonicalJson, integrityMatches } from './integrity';
import { planWam2Restore, serializeWam2SongState, type Wam2SongPayload } from './persist';
import { collectWam2RuntimeConstraints } from './runtimeConstraints';
import type {
  Wam2NoteEvent,
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
  cpuPercent: number;
  latencyMs: number;
  integrityOk: boolean;
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

  constructor(context: AudioContext) {
    this.context = context;
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

  exportSongState(): Wam2SongPayload {
    const plugins: Wam2PluginInstanceState[] = [];
    for (const slot of this.slots.values()) {
      plugins.push({
        ...slot.instance,
        paramState: slot.plugin ? { ...slot.instance.paramState, gain: slot.plugin.getParam('gain') } : slot.instance.paramState,
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
      origin: 'bundled',
      placement: slot.instance.placement,
      status: slot.status,
      cpuPercent: slot.cpuPercent,
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
    const plan = await planWam2Restore(payload);
    const ports = portsById ?? (this.graph ? collectSlotPorts(this.graph) : new Map());

    for (const missing of plan.missing) {
      const slotPorts = ports.get(missing.slotId) ?? this.ensureLiveSlotPorts(missing);
      this.slots.set(missing.slotId, {
        instance: missing,
        ports: slotPorts,
        plugin: null,
        status: isAllowlistedPackageId(missing.packageId) ? 'failed' : 'missing',
        lastError: isAllowlistedPackageId(missing.packageId)
          ? 'integrity or version mismatch — not substituted'
          : `missing plugin ${missing.packageId}@${missing.version}`,
        cpuPercent: 0,
        latencyMs: 0,
        integrityOk: false,
      });
      slotPorts.failSafeBypass();
      this.reportPlaceholder(missing.slotId, 'missing plugin — slot bypassed');
    }
    for (const instance of plan.load) {
      const slotPorts = ports.get(instance.slotId) ?? this.ensureLiveSlotPorts(instance);
      await this.mountInstance(instance, slotPorts);
    }
    this.publishTelemetry();
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

  async mountInstance(instance: Wam2PluginInstanceState, ports: WamSlotPorts): Promise<void> {
    const started = typeof performance !== 'undefined' ? performance.now() : 0;
    const controller = new AbortController();
    const live: LiveSlot = {
      instance,
      ports,
      plugin: null,
      status: 'loading',
      cpuPercent: 0,
      latencyMs: 0,
      integrityOk: false,
    };
    this.slots.set(instance.slotId, live);

    try {
      const bundled = await getBundledPackage(instance.packageId);
      if (!bundled) {
        throw new Error(`not allowlisted: ${instance.packageId}`);
      }
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

      const plugin = await createBundledPlugin(instance.packageId);
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
      live.cpuPercent = 0;
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
