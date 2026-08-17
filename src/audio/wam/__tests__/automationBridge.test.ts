import { describe, expect, it, vi } from 'vitest';
import { AutomationScheduler } from '../../automation/AutomationScheduler';
import { WamHost } from '../WamHost';
import { applyWamSlotsToGraph } from '../applySlots';
import { CLASSIC_ELECTRIBE_GRAPH, compileAudioGraph } from '../../graph';
import { finalizeBundledCatalog, HYPHON_GAIN_PACKAGE_ID } from '../catalog';
import { collectSlotPorts } from '../WamHost';
import { serializeWam2SongState } from '../persist';
import { automationStore, generateLaneId, resetLaneIdCounter } from '../../../stores/automationStore';
import type { UnifiedAutomationLane } from '../../../types';
import { makeWamTestAudioContext } from './audioContextMock';

function makeLane(overrides?: Partial<UnifiedAutomationLane>): UnifiedAutomationLane {
  return {
    id: generateLaneId(),
    target: 'wam',
    parameter: 'wam-gain-1/gain',
    name: 'WAM2 Gain',
    points: [{ step: 0, value: 0.25 }],
    interpolation: 'linear',
    source: 'recorded',
    scope: 'pattern',
    patternIndex: 0,
    enabled: true,
    ...overrides,
  };
}

describe('AutomationScheduler WAM2 bridge', () => {
  it('records and replays one WAM parameter through existing lanes', async () => {
    resetLaneIdCounter();
    automationStore.importLanes([]);
    const catalog = await finalizeBundledCatalog();
    const pkg = catalog.find((p) => p.id === HYPHON_GAIN_PACKAGE_ID)!;
    const instance = {
      slotId: 'wam-gain-1',
      packageId: pkg.id,
      version: pkg.version,
      integrity: pkg.integrity,
      placement: 'trackInsert' as const,
      attachToNodeId: 'masterSaturation',
      interceptFromNodeId: 'synthABus',
      paramState: { gain: 0.8 },
    };
    const ctx = makeWamTestAudioContext();
    const graph = compileAudioGraph(ctx, applyWamSlotsToGraph(CLASSIC_ELECTRIBE_GRAPH, [instance]));
    const host = new WamHost(ctx);
    host.attachCompiledGraph(graph);
    await host.restore(serializeWam2SongState([instance]), collectSlotPorts(graph));
    const setParam = vi.spyOn(host, 'setParam');
    const scheduler = new AutomationScheduler(ctx, null);
    scheduler.setWamHost(host);
    const lane = makeLane();
    automationStore.importLanes([lane]);
    scheduler.scheduleFromLanes([lane], 0, 1, 0.5, 0);
    expect(setParam).toHaveBeenCalledWith('wam-gain-1', 'gain', 0.25, expect.any(Number));
  });
});
