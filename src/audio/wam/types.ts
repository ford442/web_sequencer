/**
 * WAM2 host contract (Phase A).
 *
 * Hyphon already uses the label "WAM" for AssemblyScript oscillators
 * (`wam-saw`, engine `wam`). This module is **Web Audio Modules 2.0** and
 * uses `wam2` identifiers everywhere to avoid colliding with that family.
 *
 * Official SDK pin: `@webaudiomodules/sdk@0.0.12` (MIT). Phase A speaks the
 * WAM2 descriptor/lifecycle/state/param/MIDI contract via first-party
 * fixtures; the official SDK is lazy-loaded only when a community package
 * is allowlisted (see ADR).
 */

export const OFFICIAL_WAM_SDK_PACKAGE = '@webaudiomodules/sdk' as const;
export const OFFICIAL_WAM_SDK_VERSION = '0.0.12' as const;
export const OFFICIAL_WAM_SDK_LICENSE = 'MIT' as const;

export type Wam2PackageKind = 'instrument' | 'effect';

export type Wam2Placement = 'instrument' | 'trackInsert' | 'masterInsert' | 'sendReturn';

export type Wam2SlotStatus =
  | 'empty'
  | 'loading'
  | 'ready'
  | 'bypassed'
  | 'missing'
  | 'failed'
  | 'timeout';

export type Wam2OfflineSupport = 'native' | 'unsupported';

export interface Wam2Permissions {
  audio: true;
  network: false;
  filesystem: false;
  cloudTokens: false;
}

export const WAM2_DEFAULT_PERMISSIONS: Wam2Permissions = {
  audio: true,
  network: false,
  filesystem: false,
  cloudTokens: false,
};

export interface Wam2ParamDesc {
  id: string;
  label: string;
  min: number;
  max: number;
  defaultValue: number;
}

export interface Wam2PackageDescriptor {
  /** Allowlisted package id — never a remote URL. */
  id: string;
  version: string;
  kind: Wam2PackageKind;
  title: string;
  vendor: string;
  license: string;
  origin: 'bundled';
  params: Wam2ParamDesc[];
  /** SHA-256 (or test-only fnv1a32) of the canonical fingerprint. */
  integrity: { alg: 'sha256' | 'fnv1a32'; value: string };
  offline: Wam2OfflineSupport;
  isolation: 'audio-graph-slot';
  permissions: Wam2Permissions;
}

export interface Wam2PluginInstanceState {
  slotId: string;
  packageId: string;
  version: string;
  integrity: { alg: 'sha256' | 'fnv1a32'; value: string };
  placement: Wam2Placement;
  /** Graph node the slot feeds (instrument) or sits in front of (insert). */
  attachToNodeId: string;
  /** When set, only this predecessor→attach edge is intercepted (track insert). */
  interceptFromNodeId?: string;
  trackKey?: 'partA' | 'partB' | 'bass2';
  /** Normalized 0–1 param values keyed by param id. */
  paramState: Record<string, number>;
  /** Opaque plugin getState() payload. */
  pluginState?: unknown;
  bypass?: boolean;
}

export interface Wam2NoteEvent {
  midi: number;
  velocity: number;
  time: number;
  durationSeconds: number;
}

export interface Wam2Plugin {
  readonly descriptor: Wam2PackageDescriptor;
  readonly audioNode: AudioNode;
  initialize(context: AudioContext, signal?: AbortSignal): Promise<void>;
  setParam(id: string, value: number, time?: number): void;
  getParam(id: string): number;
  getState(): unknown;
  setState(state: unknown): void;
  noteOn?(event: Wam2NoteEvent): void;
  noteOff?(midi: number, time: number): void;
  dispose(): void;
}

export interface Wam2SlotTelemetry {
  slotId: string;
  packageId: string;
  version: string;
  origin: 'bundled';
  placement: Wam2Placement;
  status: Wam2SlotStatus;
  cpuPercent: number;
  latencyMs: number;
  lastError?: string;
  isolation: 'audio-graph-slot';
  permissions: Wam2Permissions;
  offline: Wam2OfflineSupport;
  integrityOk: boolean;
}

export interface Wam2RuntimeConstraints {
  crossOriginIsolated: boolean;
  coopHint: string | null;
  audioWorklet: boolean;
  worker: boolean;
  baseUrl: string;
  subdirectoryDeploy: boolean;
}

export const WAM2_INIT_TIMEOUT_MS = 2000;
