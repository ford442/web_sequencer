/**
 * End-to-end for a NON-FIXTURE package: hyphon.pulsar ships as a separate file
 * under public/wam/community/, is fetched and hashed at runtime, and is imported
 * only after the hash matches the allowlist.
 *
 * Covers the Phase B acceptance path: install → play a note → automate a param →
 * survive save/load, plus the two refusals that must never degrade into a
 * substitution.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AutomationScheduler } from '../../automation/AutomationScheduler';
import { CLASSIC_ELECTRIBE_GRAPH, compileAudioGraph } from '../../graph';
import { automationStore, generateLaneId, resetLaneIdCounter } from '../../../stores/automationStore';
import type { UnifiedAutomationLane } from '../../../types';
import { applyWamSlotsToGraph } from '../applySlots';
import { resetWam2CatalogCache } from '../catalogSource';
import { resetInstallerState } from '../installer';
import { serializeWam2SongState } from '../persist';
import { collectSlotPorts, WamHost } from '../WamHost';
import type { Wam2PluginInstanceState } from '../types';
import { makeWamTestAudioContext } from './audioContextMock';

const REPO_ROOT = process.cwd();
const COMMUNITY_ID = 'hyphon.pulsar';
const catalogText = readFileSync(join(REPO_ROOT, 'public/wam/catalog.json'), 'utf8');
const packageSource = readFileSync(
  join(REPO_ROOT, 'public/wam/community/hyphon.pulsar/index.js'),
  'utf8',
);
const catalogEntry = (JSON.parse(catalogText) as {
  packages: { id: string; version: string; integrity?: { alg: string; value: string } }[];
}).packages.find((p) => p.id === COMMUNITY_ID)!;

function makeFetch(packageBody = packageSource): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('wam/catalog.json')) return new Response(catalogText, { status: 200 });
    if (url.endsWith('hyphon.pulsar/index.js')) return new Response(packageBody, { status: 200 });
    return new Response('not found', { status: 404, statusText: 'Not Found' });
  }) as unknown as typeof fetch;
}

const importReal = () => import('../../../../public/wam/community/hyphon.pulsar/index.js');

function installOptions(packageBody?: string) {
  return {
    fetchImpl: makeFetch(packageBody),
    importImpl: importReal,
    isEnabled: () => true,
  };
}

function makeInstance(overrides: Partial<Wam2PluginInstanceState> = {}): Wam2PluginInstanceState {
  return {
    slotId: 'wam-pulsar-1',
    packageId: COMMUNITY_ID,
    version: catalogEntry.version,
    integrity: catalogEntry.integrity as { alg: 'sha256'; value: string },
    placement: 'instrument',
    attachToNodeId: 'synthABus',
    trackKey: 'partA',
    paramState: { cutoff: 2400, detune: 12, gain: 0.7 },
    ...overrides,
  };
}

async function mountHost(instance: Wam2PluginInstanceState, packageBody?: string) {
  const ctx = makeWamTestAudioContext();
  const graph = compileAudioGraph(ctx, applyWamSlotsToGraph(CLASSIC_ELECTRIBE_GRAPH, [instance]));
  const host = new WamHost(ctx, { install: installOptions(packageBody) });
  host.attachCompiledGraph(graph);
  await host.restore(serializeWam2SongState([instance]), collectSlotPorts(graph));
  return { ctx, host };
}

beforeEach(() => {
  resetInstallerState();
  resetWam2CatalogCache();
  globalThis.localStorage?.clear();
});

describe('community package lifecycle', () => {
  it('installs and mounts from the catalog', async () => {
    const { host } = await mountHost(makeInstance());
    expect(host.getSlotStatus('wam-pulsar-1')).toBe('ready');
    const telemetry = host.telemetry()[0];
    expect(telemetry.origin).toBe('community');
    expect(telemetry.integrityOk).toBe(true);
    // Not a number: native AudioNodes have no per-slot meter, and 0 would read
    // as "free" rather than "unknown".
    expect(telemetry.cpuPercent).toBeNull();
  });

  it('plays a note through the mounted community instrument', async () => {
    const { ctx, host } = await mountHost(makeInstance());
    const before = (ctx.createOscillator as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(host.takesOverTrack('partA')).toBe(true);
    host.scheduleTrackNotes('partA', 'C4', 0, 0.25, 0.9);
    // Pulsar is a two-oscillator voice.
    const created = (ctx.createOscillator as ReturnType<typeof vi.fn>).mock.calls.length - before;
    expect(created).toBe(2);
  });

  it('automates one param through the existing lane path', async () => {
    resetLaneIdCounter();
    automationStore.importLanes([]);
    const { ctx, host } = await mountHost(makeInstance());
    const setParam = vi.spyOn(host, 'setParam');
    const lane: UnifiedAutomationLane = {
      id: generateLaneId(),
      target: 'wam',
      parameter: 'wam-pulsar-1/cutoff',
      name: 'Pulsar · Cutoff',
      points: [{ step: 0, value: 0.5 }],
      interpolation: 'linear',
      source: 'manual',
      scope: 'pattern',
      patternIndex: 0,
      enabled: true,
    };
    const scheduler = new AutomationScheduler(ctx, null);
    scheduler.setWamHost(host);
    scheduler.scheduleFromLanes([lane], 0, 1, 0.5, 0);
    expect(setParam).toHaveBeenCalledWith('wam-pulsar-1', 'cutoff', 0.5, expect.any(Number));
  });

  it('survives save/load with every declared param, not just gain', async () => {
    const { host } = await mountHost(makeInstance());
    host.setParam('wam-pulsar-1', 'cutoff', 5000);
    host.setParam('wam-pulsar-1', 'detune', -20);
    host.setParam('wam-pulsar-1', 'gain', 0.42);

    const saved = host.exportSongState();
    const savedSlot = saved.plugins[0];
    expect(savedSlot.paramState).toMatchObject({ cutoff: 5000, detune: -20, gain: 0.42 });

    resetInstallerState();
    resetWam2CatalogCache();
    const ctx2 = makeWamTestAudioContext();
    const graph2 = compileAudioGraph(
      ctx2,
      applyWamSlotsToGraph(CLASSIC_ELECTRIBE_GRAPH, [savedSlot]),
    );
    const reloaded = new WamHost(ctx2, { install: installOptions() });
    reloaded.attachCompiledGraph(graph2);
    await reloaded.restore(saved, collectSlotPorts(graph2));

    expect(reloaded.getSlotStatus('wam-pulsar-1')).toBe('ready');
    expect(reloaded.getParam('wam-pulsar-1', 'cutoff')).toBe(5000);
    expect(reloaded.getParam('wam-pulsar-1', 'detune')).toBe(-20);
    expect(reloaded.getParam('wam-pulsar-1', 'gain')).toBeCloseTo(0.42, 5);
  });

  it('bypasses — never substitutes — when the package bytes changed since save', async () => {
    const tampered = `${packageSource}\n// edited without refreshing the catalog`;
    const instance = makeInstance();
    const ctx = makeWamTestAudioContext();
    const graph = compileAudioGraph(ctx, applyWamSlotsToGraph(CLASSIC_ELECTRIBE_GRAPH, [instance]));
    const host = new WamHost(ctx, { install: installOptions(tampered) });
    host.attachCompiledGraph(graph);
    await host.restore(serializeWam2SongState([instance]), collectSlotPorts(graph));

    const slot = host.telemetry()[0];
    // The saved identity still matches the catalog, so the plan loads it; the
    // installer is what refuses, at the byte check.
    expect(slot.status).toBe('failed');
    expect(slot.lastError).toMatch(/integrity mismatch/);
    expect(host.getSlotDescriptor('wam-pulsar-1')).toBeNull();
    // Bypass is open, so the rest of the graph still passes audio.
    expect(host.getSlotPorts('wam-pulsar-1')?.bypass.gain.value).toBe(1);
  });

  it('bypasses when the saved version no longer matches the catalog', async () => {
    const { host } = await mountHost(makeInstance({ version: '0.9.0' }));
    const slot = host.telemetry()[0];
    expect(slot.status).toBe('failed');
    expect(slot.lastError).toMatch(/saved hyphon\.pulsar@0\.9\.0/);
    expect(host.getSlotDescriptor('wam-pulsar-1')).toBeNull();
  });

  it('marks an unknown package missing rather than failed', async () => {
    const { host } = await mountHost(makeInstance({ packageId: 'evil.package' }));
    const slot = host.telemetry()[0];
    expect(slot.status).toBe('missing');
    expect(slot.lastError).toMatch(/not in the allowlist/);
  });
});

describe('slot controls', () => {
  it('bypasses and unbypasses without unloading the plugin', async () => {
    const { host } = await mountHost(makeInstance());
    host.setParam('wam-pulsar-1', 'cutoff', 900);

    expect(host.setBypass('wam-pulsar-1', true)).toBe(true);
    expect(host.getSlotStatus('wam-pulsar-1')).toBe('bypassed');
    expect(host.getSlotPorts('wam-pulsar-1')?.bypass.gain.value).toBe(1);

    expect(host.setBypass('wam-pulsar-1', false)).toBe(true);
    expect(host.getSlotStatus('wam-pulsar-1')).toBe('ready');
    // State survived — bypass is a monitoring control, not an unload.
    expect(host.getParam('wam-pulsar-1', 'cutoff')).toBe(900);
  });

  it('restarts a slot and carries param state across', async () => {
    const { host } = await mountHost(makeInstance());
    host.setParam('wam-pulsar-1', 'cutoff', 777);
    await expect(host.restartSlot('wam-pulsar-1')).resolves.toBe(true);
    expect(host.getSlotStatus('wam-pulsar-1')).toBe('ready');
    expect(host.getParam('wam-pulsar-1', 'cutoff')).toBe(777);
  });

  it('reports false for controls on an unknown slot', async () => {
    const { host } = await mountHost(makeInstance());
    expect(host.setBypass('nope', true)).toBe(false);
    await expect(host.restartSlot('nope')).resolves.toBe(false);
  });
});

describe('presets', () => {
  it('captures and re-applies a preset', async () => {
    const { host } = await mountHost(makeInstance());
    host.setParam('wam-pulsar-1', 'cutoff', 6000);
    const preset = host.capturePreset('wam-pulsar-1')!;
    expect(preset.packageId).toBe(COMMUNITY_ID);
    expect(preset.paramState.cutoff).toBe(6000);

    host.setParam('wam-pulsar-1', 'cutoff', 200);
    expect(host.applyPreset('wam-pulsar-1', preset)).toBe(true);
    expect(host.getParam('wam-pulsar-1', 'cutoff')).toBe(6000);
  });

  it('refuses a preset from a different package', async () => {
    const { host } = await mountHost(makeInstance());
    const foreign = {
      packageId: 'hyphon.tone',
      version: '1.0.0',
      paramState: { gain: 0.1 },
    };
    expect(host.applyPreset('wam-pulsar-1', foreign)).toBe(false);
  });
});
