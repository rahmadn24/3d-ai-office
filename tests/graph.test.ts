/** Guardrail tests: the corridor graph. If a future edit disconnects an aisle,
 *  avatars silently walk through tables again — these tests fail first.
 *  Run: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EDGES, NODE_POS, POS, bfs, nearestNode, planRoute } from "../lib/office-graph";

const NODES = Object.keys(NODE_POS);

test("every edge endpoint exists as a node", () => {
  for (const [from, tos] of Object.entries(EDGES)) {
    assert.ok(NODE_POS[from], `node ${from} missing from NODE_POS`);
    for (const to of tos) assert.ok(NODE_POS[to], `edge ${from} -> ${to} points nowhere`);
  }
});

test("every edge has its reverse (bots must walk back)", () => {
  for (const [from, tos] of Object.entries(EDGES)) {
    for (const to of tos) {
      assert.ok((EDGES[to] ?? []).includes(from), `missing reverse edge ${to} -> ${from}`);
    }
  }
});

test("every node reaches every other node (no stranded rooms)", () => {
  for (const a of NODES) {
    for (const b of NODES) {
      if (a === b) continue;
      const path = bfs(a, b);
      assert.ok(path.length > 0, `no route ${a} -> ${b}`);
      assert.equal(path[path.length - 1], b);
      // each hop must be a real edge
      let cur = a;
      for (const hop of path) {
        assert.ok((EDGES[cur] ?? []).includes(hop), `illegal hop ${cur} -> ${hop}`);
        cur = hop;
      }
    }
  }
});

test("room entries are reachable from the west end (desks side)", () => {
  for (const entry of ["E0", "E1", "S0", "M0"]) {
    assert.ok(bfs("W1", entry).length > 0, `room entry ${entry} unreachable from desks`);
  }
});

test("nearestNode snaps a desk-side position to the corridor", () => {
  assert.equal(nearestNode(-15, 0.5), "W1");
  assert.equal(nearestNode(15.5, 8.3), "M0");
});

test("planRoute for an unmounted bot appears at goal (no walk-in)", () => {
  POS.delete("ghost");
  assert.deepEqual(planRoute("ghost", [1, 2], "E0"), [[1, 2]]);
});

test("planRoute without entry walks straight", () => {
  POS.set("stroller", [-15, 0.5]);
  assert.deepEqual(planRoute("stroller", [2, -7.5], null), [[2, -7.5]]);
});

test("planRoute across the office ends at goal via the graph", () => {
  POS.set("commuter", [-15, 0.5]); // standing at W1
  const route = planRoute("commuter", [15.5, 8.3], "M0");
  assert.ok(route.length > 2, `expected multi-leg route, got ${JSON.stringify(route)}`);
  assert.deepEqual(route[route.length - 1], [15.5, 8.3]);
});
