import type { AudioGraphConfig, GraphNodeFactory, GraphNodeId } from './types';

/**
 * Delay-class factories that make a feedback loop audio-safe (a time offset
 * exists in the cycle). All other cycles are rejected.
 */
const DELAY_FACTORIES = new Set<GraphNodeFactory>(['delay']);

export class GraphCycleError extends Error {
  readonly cycle: readonly GraphNodeId[];

  constructor(cycle: readonly GraphNodeId[]) {
    super(
      `AudioGraph compile failed: unsafe cycle ${cycle.join(' → ')} (feedback requires a delay node)`,
    );
    this.name = 'GraphCycleError';
    this.cycle = cycle;
  }
}

function factoryById(config: AudioGraphConfig): Map<GraphNodeId, GraphNodeFactory> {
  const map = new Map<GraphNodeId, GraphNodeFactory>();
  for (const node of config.nodes) {
    map.set(node.id, node.factory);
  }
  return map;
}

function adjacency(config: AudioGraphConfig): Map<GraphNodeId, GraphNodeId[]> {
  const adj = new Map<GraphNodeId, GraphNodeId[]>();
  for (const node of config.nodes) {
    adj.set(node.id, []);
  }
  for (const edge of config.edges) {
    const list = adj.get(edge.from);
    if (list) {
      list.push(edge.to);
    } else {
      adj.set(edge.from, [edge.to]);
    }
  }
  return adj;
}

/**
 * DFS that records one simple cycle if present. Returns node ids in cycle
 * order including the repeated start node at the end.
 */
function findCycle(adj: Map<GraphNodeId, GraphNodeId[]>): GraphNodeId[] | null {
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<GraphNodeId, number>();
  const parent = new Map<GraphNodeId, GraphNodeId | null>();
  for (const id of adj.keys()) {
    color.set(id, WHITE);
    parent.set(id, null);
  }

  let found: GraphNodeId[] | null = null;

  const visit = (u: GraphNodeId): void => {
    if (found) return;
    color.set(u, GRAY);
    for (const v of adj.get(u) ?? []) {
      if (found) return;
      const c = color.get(v) ?? WHITE;
      if (c === WHITE) {
        parent.set(v, u);
        visit(v);
      } else if (c === GRAY) {
        const cycle: GraphNodeId[] = [v];
        let cur: GraphNodeId | null = u;
        while (cur && cur !== v) {
          cycle.push(cur);
          cur = parent.get(cur) ?? null;
        }
        cycle.push(v);
        cycle.reverse();
        found = cycle;
        return;
      }
    }
    color.set(u, BLACK);
  };

  for (const id of adj.keys()) {
    if ((color.get(id) ?? WHITE) === WHITE) {
      visit(id);
    }
  }
  return found;
}

function cycleHasDelay(
  cycle: readonly GraphNodeId[],
  factories: Map<GraphNodeId, GraphNodeFactory>,
): boolean {
  // Last id repeats the start; skip it.
  const unique = cycle.slice(0, -1);
  return unique.some((id) => DELAY_FACTORIES.has(factories.get(id) ?? 'gain'));
}

/**
 * Reject graph cycles unless at least one delay node sits on the cycle.
 * The classic Electribe delay feedback loop is the allowed example.
 */
export function assertSafeGraphCycles(config: AudioGraphConfig): void {
  const adj = adjacency(config);
  const cycle = findCycle(adj);
  if (!cycle) return;
  const factories = factoryById(config);
  if (cycleHasDelay(cycle, factories)) return;
  throw new GraphCycleError(cycle);
}
