/** Guardrail tests: night-shift orchestration. computeDue is pure computation —
 *  who wakes, who waits, who skips — so the whole shift order is pinned here.
 *  Run: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { computeDue, shiftKey } from "../lib/orchestrator";
import { getDb } from "../lib/db";

// --- fixture (runs at file load, before any test) ---
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "kantor-orch-"));
process.chdir(ROOT);

const MEMBERS: Record<string, { wake: string | null; enabled: boolean; skipIfIdle: boolean; after: string[] }> = {
  a: { wake: "22:30", enabled: true, skipIfIdle: false, after: [] },
  b: { wake: "22:30", enabled: true, skipIfIdle: false, after: ["a"] },
  c: { wake: "22:30", enabled: true, skipIfIdle: true, after: [] },
  d: { wake: "22:30", enabled: false, skipIfIdle: false, after: [] },
  e: { wake: null, enabled: true, skipIfIdle: false, after: [] },
  f: { wake: "23:30", enabled: true, skipIfIdle: false, after: [] },
  g: { wake: "22:30", enabled: true, skipIfIdle: false, after: [] },
  h: { wake: "22:30", enabled: true, skipIfIdle: false, after: [] },
  i: { wake: "22:30", enabled: true, skipIfIdle: false, after: [] },
  noon: { wake: "12:00", enabled: true, skipIfIdle: false, after: [] },
};
fs.mkdirSync("agents", { recursive: true });
fs.writeFileSync(
  "agents/schedule.json",
  JSON.stringify({
    window: { start: "22:00", end: "06:00", timezone: "Asia/Jakarta" },
    maxParallel: 1,
    retryFailedOnce: true,
    members: MEMBERS,
  }),
);
for (const m of Object.keys(MEMBERS)) fs.mkdirSync(`agents/${m}/workspace/inbox`, { recursive: true });

// Local 23:00 — deep inside the night window, a/b/c/g/h/i wakes passed.
const NIGHT = new Date(2026, 9, 9, 23, 0, 0);

function addRun(division: string, status: string, at: Date) {
  getDb()
    .prepare("INSERT INTO runs (division, started_at, status) VALUES (?, ?, ?)")
    .run(division, at.toISOString(), status);
}
function dueIds(r: { due: Array<{ division: string }> }): string[] {
  return r.due.map((d) => d.division);
}
function skipReason(r: { skipped: Array<{ division: string; reason: string }> }, id: string): string | undefined {
  return r.skipped.find((s) => s.division === id)?.reason;
}

test("shiftKey: after midnight still belongs to yesterday's shift", () => {
  assert.equal(shiftKey(new Date(2026, 9, 10, 2, 0)), "2026-10-09");
  assert.equal(shiftKey(new Date(2026, 9, 9, 23, 0)), "2026-10-09");
});

test("plain member is due after wake; future wake lands in next", () => {
  const r = computeDue(NIGHT);
  assert.ok(dueIds(r).includes("a"), "a should be due");
  assert.ok(!dueIds(r).includes("f"), "f wakes at 23:30, not yet");
  assert.ok(r.next.some((n) => n.division === "f" && n.wake === "23:30"));
});

test("dependency: b waits for a, wakes after a finishes", () => {
  let r = computeDue(NIGHT);
  assert.equal(skipReason(r, "b"), "waiting for a");
  addRun("a", "ok", NIGHT);
  r = computeDue(NIGHT);
  assert.ok(dueIds(r).includes("b"), "b should be due once a is ok");
  assert.ok(!dueIds(r).includes("a"), "a already finished tonight");
});

test("skipIfIdle: empty inbox skips, inbox file wakes", () => {
  let r = computeDue(NIGHT);
  assert.equal(skipReason(r, "c"), "no inbox work");
  fs.writeFileSync("agents/c/workspace/inbox/tugas.md", "kerja");
  r = computeDue(NIGHT);
  assert.ok(dueIds(r).includes("c"));
});

test("failed once retries; failed twice spends the budget", () => {
  addRun("g", "failed", NIGHT);
  let r = computeDue(NIGHT);
  const g = r.due.find((d) => d.division === "g");
  assert.ok(g, "g should be due for retry");
  assert.equal(g!.reason, "retry after failure");
  addRun("g", "failed", new Date(NIGHT.getTime() + 60000));
  r = computeDue(NIGHT);
  assert.equal(skipReason(r, "g"), "failed, retry budget spent");
});

test("currently-running member is not double-woken", () => {
  addRun("h", "running", new Date(NIGHT.getTime() - 5 * 60000));
  const r = computeDue(NIGHT);
  assert.equal(skipReason(r, "h"), "already working");
});

test("finished member appears in neither due nor next", () => {
  addRun("i", "needs_you", NIGHT);
  const r = computeDue(NIGHT);
  assert.ok(!dueIds(r).includes("i"));
  assert.ok(!r.next.some((n) => n.division === "i"));
});

test("disabled and wakeless members are invisible", () => {
  const r = computeDue(NIGHT);
  for (const id of ["d", "e"]) {
    assert.ok(!dueIds(r).includes(id), `${id} must never be due`);
    assert.ok(!r.next.some((n) => n.division === id), `${id} must never be next`);
    assert.equal(skipReason(r, id), undefined);
  }
});

test("daytime pass skips with 'outside night window'", () => {
  const noon = new Date(2026, 9, 10, 12, 30, 0);
  const r = computeDue(noon);
  assert.equal(r.due.length, 0, "nothing may wake at noon");
  assert.equal(skipReason(r, "noon"), "outside night window");
});
