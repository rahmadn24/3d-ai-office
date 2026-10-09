/** Usage parser: step_finish token chunks must add up exactly. Run: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getUsage } from "../lib/usage";
import { getDb } from "../lib/db";

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "kantor-usage-"));
process.chdir(ROOT);
fs.mkdirSync("data/runs", { recursive: true });

const now = new Date();
getDb().prepare("INSERT INTO runs (division, started_at, status) VALUES (?, ?, 'ok')").run("gilang", now.toISOString());
fs.writeFileSync(
  "data/runs/run-1.log",
  [
    '{"type":"step_finish","tokens":{"input":1000,"output":50,"reasoning":0,"cache":{"read":200,"write":0}}}',
    '{"type":"step_finish","tokens":{"input":500,"output":25,"reasoning":10,"cache":{"read":0,"write":5}}}',
    '{"type":"text","text":"no tokens here"}',
  ].join("\n"),
);
// run 2: in DB but log file missing -> tokens 0, still counted as a run
getDb().prepare("INSERT INTO runs (division, started_at, status) VALUES (?, ?, 'ok')").run("laras", now.toISOString());
// run 3: older than the 24h window -> excluded from 24h, included in 30d
const old = new Date(now.getTime() - 10 * 24 * 3600_000);
getDb().prepare("INSERT INTO runs (division, started_at, status) VALUES (?, ?, 'ok')").run("dimas", old.toISOString());
fs.writeFileSync("data/runs/run-3.log", '{"type":"step_finish","tokens":{"input":7,"output":0,"reasoning":0,"cache":{"read":0,"write":0}}}');

test("token chunks sum exactly per run", () => {
  const r = getUsage("30d", true);
  const g = r.rows.find((x) => x.division === "gilang")!;
  assert.equal(g.input, 1500);
  assert.equal(g.output, 75);
  assert.equal(g.reasoning, 10);
  assert.equal(g.cacheRead, 200);
  assert.equal(g.cacheWrite, 5);
  assert.equal(g.total, 1585);
});

test("missing log counts as a zero-token run", () => {
  const r = getUsage("30d", true);
  const l = r.rows.find((x) => x.division === "laras")!;
  assert.equal(l.total, 0);
  assert.equal(r.runs, 3);
});

test("range filter keeps old runs out of 24h", () => {
  const day = getUsage("24h", true);
  assert.ok(!day.rows.some((x) => x.division === "dimas"));
  assert.equal(day.runs, 2);
  const month = getUsage("30d", true);
  assert.ok(month.rows.some((x) => x.division === "dimas"));
});

test("per-member ranking carries shares that sum to ~100", () => {
  const r = getUsage("30d", true);
  assert.equal(r.byMember[0].division, "gilang");
  const share = r.byMember.reduce((a, m) => a + m.share, 0);
  assert.ok(Math.abs(share - 100) < 1.1, `shares sum to ${share}`);
  assert.equal(r.input, 1507);
});
