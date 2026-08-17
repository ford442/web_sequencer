import type { AudioGraphConfig, GraphEdgeSpec, GraphNodeSpec } from '../graph/types';
import type { Wam2Placement, Wam2PluginInstanceState } from './types';

const FACTORY_BY_PLACEMENT: Record<Wam2Placement, GraphNodeSpec['factory']> = {
  instrument: 'wamInstrumentSlot',
  trackInsert: 'wamTrackInsert',
  masterInsert: 'wamMasterInsert',
  sendReturn: 'wamSendReturn',
};

const ROLE_BY_PLACEMENT: Record<Wam2Placement, GraphNodeSpec['role']> = {
  instrument: 'instrumentSource',
  trackInsert: 'trackInsert',
  masterInsert: 'masterInsert',
  sendReturn: 'auxSend',
};

function incomingTo(edges: readonly GraphEdgeSpec[], nodeId: string): GraphEdgeSpec[] {
  return edges.filter((e) => e.to === nodeId);
}

/**
 * Splice WAM2 slots into a declarative graph. Does not compile audio —
 * {@link compileAudioGraph} still owns connections.
 */
export function applyWamSlotsToGraph(
  base: AudioGraphConfig,
  instances: readonly Wam2PluginInstanceState[],
): AudioGraphConfig {
  const nodes = [...base.nodes];
  let edges = [...base.edges];

  for (const instance of instances) {
    const slotId = instance.slotId;
    if (nodes.some((n) => n.id === slotId)) {
      continue;
    }
    nodes.push({
      id: slotId,
      factory: FACTORY_BY_PLACEMENT[instance.placement],
      role: ROLE_BY_PLACEMENT[instance.placement],
    });

    const attach = instance.attachToNodeId;
    if (instance.placement === 'instrument') {
      edges.push({ from: slotId, to: attach });
      continue;
    }

    if (instance.placement === 'sendReturn') {
      edges.push({ from: attach, to: slotId });
      edges.push({ from: slotId, to: 'masterSaturation' });
      continue;
    }

    const fromId = instance.interceptFromNodeId;
    if (fromId) {
      edges = edges.filter((e) => !(e.from === fromId && e.to === attach));
      edges.push({ from: fromId, to: slotId });
      edges.push({ from: slotId, to: attach });
      continue;
    }

    const incoming = incomingTo(edges, attach);
    edges = edges.filter((e) => e.to !== attach);
    for (const edge of incoming) {
      edges.push({ from: edge.from, to: slotId });
    }
    edges.push({ from: slotId, to: attach });
  }

  return {
    ...base,
    id: `${base.id}+wam2`,
    name: `${base.name} + WAM2 slots`,
    nodes,
    edges,
  };
}
