import { describe, expect, it } from 'vitest';
import { applyWamSlotsToGraph } from '../applySlots';
import { CLASSIC_ELECTRIBE_GRAPH, compileAudioGraph } from '../../graph';
import { finalizeBundledCatalog, HYPHON_GAIN_PACKAGE_ID, HYPHON_TONE_PACKAGE_ID } from '../catalog';
import { collectSlotPorts, WamHost } from '../WamHost';
import { serializeWam2SongState, planWam2Restore } from '../persist';
import { OFFICIAL_WAM_SDK_PACKAGE, OFFICIAL_WAM_SDK_VERSION } from '../types';
import type { Wam2PluginInstanceState } from '../types';
import { engineTelemetry } from '../../../utils/engineTelemetry';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { makeWamTestAudioContext } from './audioContextMock';

function makeToneInstance(overrides?: Partial<Wam2PluginInstanceState>): Wam2PluginInstanceState {
  return {
    slotId: 'wam-tone-1',
    packageId: HYPHON_TONE_PACKAGE_ID,
    version: '1.0.0',
    integrity: { alg: 'fnv1a32', value: 'pending' },
    placement: 'instrument',
    attachToNodeId: 'synthABus',
    trackKey: 'partA',
    paramState: { gain: 0.5 },
    pluginState: { gain: 0.5, extra: { preset: 'spike' } },
    ...overrides,
  };
}

function makeGainInstance(overrides?: Partial<Wam2PluginInstanceState>): Wam2PluginInstanceState {
  return {
    slotId: 'wam-gain-1',
    packageId: HYPHON_GAIN_PACKAGE_ID,
    version: '1.0.0',
    integrity: { alg: 'fnv1a32', value: 'pending' },
    placement: 'trackInsert',
    attachToNodeId: 'masterSaturation',
    interceptFromNodeId: 'synthABus',
    paramState: { gain: 0.7 },
    ...overrides,
  };
}

async function withIntegrity<T extends Wam2PluginInstanceState>(instance: T): Promise<T> {
  const catalog = await finalizeBundledCatalog();
  const pkg = catalog.find((p) => p.id === instance.packageId);
  if (!pkg) throw new Error('missing catalog');
  return { ...instance, version: pkg.version, integrity: { ...pkg.integrity } };
}

describe('WAM2 Phase A host', () => {
  it('compiles instrument + insert ports into the existing graph', async () => {
    const tone = await withIntegrity(makeToneInstance());
    const fx = await withIntegrity(makeGainInstance());
    const config = applyWamSlotsToGraph(CLASSIC_ELECTRIBE_GRAPH, [tone, fx]);
    const graph = compileAudioGraph(makeWamTestAudioContext(), config);
    expect(graph.getPort('wam-tone-1').wamSlot).toBeDefined();
    expect(graph.getPort('wam-gain-1').input).not.toBe(graph.getPort('wam-gain-1').output);
    const pairs = graph.connectionLog.map((c) => `${c.from}->${c.to}`);
    expect(pairs).toContain('wam-tone-1->synthABus');
    expect(pairs).toContain('synthABus->wam-gain-1');
    expect(pairs).toContain('wam-gain-1->masterSaturation');
    expect(pairs).not.toContain('synthABus->masterSaturation');
  });

  it('plays sequencer notes through the instrument source port', async () => {
    const tone = await withIntegrity(makeToneInstance());
    const config = applyWamSlotsToGraph(CLASSIC_ELECTRIBE_GRAPH, [tone]);
    const ctx = makeWamTestAudioContext();
    const graph = compileAudioGraph(ctx, config);
    const host = new WamHost(ctx);
    host.attachCompiledGraph(graph);
    await host.restore(serializeWam2SongState([tone]), collectSlotPorts(graph));
    expect(host.takesOverTrack('partA')).toBe(true);
    host.scheduleTrackNotes('partA', 'A4', 0, 0.25, 0.9);
    expect(ctx.createOscillator).toHaveBeenCalled();
    expect(host.telemetry()[0]?.status).toBe('ready');
  });

  it('runs the bundled effect in a track insert and automates gain', async () => {
    const fx = await withIntegrity(makeGainInstance({ paramState: { gain: 0.2 } }));
    const config = applyWamSlotsToGraph(CLASSIC_ELECTRIBE_GRAPH, [fx]);
    const ctx = makeWamTestAudioContext();
    const graph = compileAudioGraph(ctx, config);
    const host = new WamHost(ctx);
    host.attachCompiledGraph(graph);
    await host.restore(serializeWam2SongState([fx]), collectSlotPorts(graph));
    host.setParam('wam-gain-1', 'gain', 0.9, 0);
    const exported = host.exportSongState();
    expect(exported.plugins[0]?.paramState.gain).toBe(0.9);
  });

  it('round-trips plugin state and keeps missing plugins as bypass placeholders', async () => {
    const tone = await withIntegrity(makeToneInstance());
    const missing: Wam2PluginInstanceState = {
      slotId: 'wam-gone',
      packageId: 'community.unknown',
      version: '9.9.9',
      integrity: { alg: 'sha256', value: 'deadbeef' },
      placement: 'masterInsert',
      attachToNodeId: 'masterLimiter',
      interceptFromNodeId: 'masterPanner',
      paramState: {},
    };
    const payload = serializeWam2SongState([tone, missing]);
    const plan = await planWam2Restore(payload);
    expect(plan.load).toHaveLength(1);
    expect(plan.missing).toHaveLength(1);
    expect(plan.missing[0]?.packageId).toBe('community.unknown');

    const config = applyWamSlotsToGraph(CLASSIC_ELECTRIBE_GRAPH, [tone, missing]);
    const ctx = makeWamTestAudioContext();
    const graph = compileAudioGraph(ctx, config);
    const host = new WamHost(ctx);
    host.attachCompiledGraph(graph);
    await host.restore(payload, collectSlotPorts(graph));
    const tel = host.telemetry();
    expect(tel.find((s) => s.slotId === 'wam-tone-1')?.status).toBe('ready');
    expect(tel.find((s) => s.slotId === 'wam-gone')?.status).toBe('missing');
    host.publishTelemetry();
    const snap = engineTelemetry.getRuntimeSnapshot();
    expect(snap.wam2Slots.some((s) => s.status === 'missing')).toBe(true);
    expect(snap.wam2Constraints?.baseUrl).toBeDefined();
  });

  it('does not substitute another engine when integrity fails', async () => {
    const tone = await withIntegrity(makeToneInstance());
    tone.integrity = { alg: 'sha256', value: '0000000000000000000000000000000000000000000000000000000000000000' };
    const plan = await planWam2Restore(serializeWam2SongState([tone]));
    expect(plan.load).toHaveLength(0);
    expect(plan.missing[0]?.packageId).toBe(HYPHON_TONE_PACKAGE_ID);
  });
});

describe('WAM2 bundle boundary', () => {
  it('pins the official SDK version and keeps it out of eager entries', () => {
    expect(OFFICIAL_WAM_SDK_PACKAGE).toBe('@webaudiomodules/sdk');
    expect(OFFICIAL_WAM_SDK_VERSION).toBe('0.0.12');
    const main = readFileSync(resolve(process.cwd(), 'src/main.tsx'), 'utf8');
    const app = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8');
    expect(main).not.toContain('@webaudiomodules/sdk');
    expect(app).not.toContain('@webaudiomodules/sdk');
    const loader = readFileSync(resolve(process.cwd(), 'src/audio/wam/sdk/loadOfficialSdk.ts'), 'utf8');
    expect(loader).toContain('@vite-ignore');
    expect(loader).toContain('OFFICIAL_WAM_SDK_PACKAGE');
  });
});
