/** Walkable waypoint graph for the 3D office (pure, no React/three).
 *
 *  Nodes sit on open aisles (hand-verified clear of furniture). The central
 *  east-west aisle z=-0.2 threads between the pod rows; spurs reach each
 *  room's door. Glass pass-through on the final step is accepted.
 *
 *  Kept as a separate module so `tests/graph.test.ts` can pin the topology:
 *  avatars must never lose corridor routing to a careless edit.
 */

export const NODE_POS: Record<string, [number, number]> = {
  W0: [-15, -4], W1: [-15, 0.5], W2: [-15, 4],
  C0: [-8, -0.2], C1: [-2, -0.2], C2: [4.6, -0.2],
  E0: [9, -0.2], E1: [12.6, 0.8],
  S1: [8, 5.5], S0: [2.5, 2.8], M0: [15.5, 8.3],
};

export const EDGES: Record<string, string[]> = {
  W0: ["W1"], W1: ["W0", "W2", "C0"], W2: ["W1"],
  C0: ["W1", "C1"], C1: ["C0", "C2"], C2: ["C1", "E0"],
  E0: ["C2", "E1"], E1: ["E0", "S1"], S1: ["E1", "S0", "M0"],
  S0: ["S1"], M0: ["S1"],
};

/** Live positions, written by Walkers every frame (no re-render). */
export const POS = new Map<string, [number, number]>();

export function nearestNode(x: number, z: number): string {
  let best = "C0";
  let bd = Infinity;
  for (const [k, p] of Object.entries(NODE_POS)) {
    const d = (p[0] - x) ** 2 + (p[1] - z) ** 2;
    if (d < bd) { bd = d; best = k; }
  }
  return best;
}

export function bfs(a: string, b: string): string[] {
  if (a === b) return [];
  const prev: Record<string, string | null> = { [a]: null };
  const q = [a];
  while (q.length) {
    const cur = q.shift()!;
    for (const nx of EDGES[cur] ?? []) {
      if (!(nx in prev)) {
        prev[nx] = cur;
        if (nx === b) {
          const path = [b];
          let p: string | null = b;
          while (prev[p!] !== null) { p = prev[p!]; path.unshift(p!); }
          return path.slice(1);
        }
        q.push(nx);
      }
    }
  }
  return [];
}

/** Full walkable route to a goal: corridor graph, then the final step in. */
export function planRoute(id: string, goal: [number, number], entry: string | null): Array<[number, number]> {
  const cur = POS.get(id);
  if (!cur) return [goal]; // first mount: appear at goal, no walk-in
  if (!entry) return [goal];
  const chain = bfs(nearestNode(cur[0], cur[1]), entry).map((n) => NODE_POS[n]);
  return [...chain, goal];
}
