import fs from "node:fs";
import path from "node:path";
import { getDb } from "./db";
import { memberWorkspace } from "./roster";
import { runDivision } from "./runner";

interface DivisionCfg {
  wake: string | null;
  enabled: boolean;
  skipIfIdle: boolean;
  after: string[];
}

interface Schedule {
  window: { start: string; end: string; timezone: string };
  maxParallel: number;
  retryFailedOnce: boolean;
  members: Record<string, DivisionCfg>;
}

function loadSchedule(): Schedule {
  const raw = fs.readFileSync(path.join(process.cwd(), "agents", "schedule.json"), "utf-8");
  return JSON.parse(raw) as Schedule;
}

function nowWib(): Date {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Jakarta" }));
}

function atTime(base: Date, hhmm: string): Date {
  const [h, m] = hhmm.split(":").map(Number);
  const d = new Date(base);
  d.setHours(h, m, 0, 0);
  return d;
}

/** Shift key: the 22:00 that started the current/last night shift (YYYY-MM-DD). */
export function shiftKey(now = nowWib()): string {
  const d = new Date(now);
  if (d.getHours() < 12) d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function shiftBounds(now = nowWib()): { start: Date; end: Date } {
  const [d] = [new Date(now)];
  if (d.getHours() >= 12) {
    const start = atTime(d, "22:00");
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    end.setHours(6, 0, 0, 0);
    return { start, end };
  }
  const end = atTime(d, "06:00");
  const start = new Date(end);
  start.setDate(start.getDate() - 1);
  start.setHours(22, 0, 0, 0);
  return { start, end };
}

function runsThisShift(division: string, key: string) {
  return getDb()
    .prepare("SELECT * FROM runs WHERE division = ? AND date(started_at) >= date(?) ORDER BY id DESC")
    .all(division, key) as Array<{ id: number; status: string; started_at: string }>;
}

function inboxHasWork(division: string): boolean {
  const inbox = path.join(memberWorkspace(division), "inbox");
  try {
    return fs.readdirSync(inbox).some((f) => !f.startsWith("."));
  } catch {
    return false;
  }
}

export interface DueInfo {
  division: string;
  wake: string;
  reason: string;
}

/** Which divisions should wake right now (and why). Pure computation, no side effects. */
export function computeDue(now = nowWib()): { due: DueInfo[]; skipped: Array<{ division: string; reason: string }>; next: Array<{ division: string; wake: string }> } {
  const sched = loadSchedule();
  const { start, end } = shiftBounds(now);
  const key = shiftKey(now);
  const inWindow = now >= start && now <= new Date(end.getTime() + 2 * 3600_000);
  const due: DueInfo[] = [];
  const skipped: Array<{ division: string; reason: string }> = [];
  const next: Array<{ division: string; wake: string }> = [];

  for (const [division, cfg] of Object.entries(sched.members)) {
    if (!cfg.enabled || !cfg.wake) continue;
    const wakeDt = atTime(new Date(now), cfg.wake);
    if (cfg.wake < "12:00" && now.getHours() >= 12) wakeDt.setDate(wakeDt.getDate() + 1);

    const runs = runsThisShift(division, key);
    const active = runs.find((r) => r.status === "running" && Date.now() - new Date(r.started_at).getTime() < 45 * 60000);
    if (active) {
      skipped.push({ division, reason: "already working" });
      continue;
    }
    const done = runs.some((r) => r.status === "ok" || r.status === "needs_you");
    if (done) continue; // finished tonight
    const failed = runs.filter((r) => r.status === "failed").length;

    if (now < wakeDt) {
      next.push({ division, wake: cfg.wake });
      continue;
    }
    if (!inWindow) {
      skipped.push({ division, reason: "outside night window" });
      continue;
    }
    const unmetDep = cfg.after.find((dep) => {
      const depRuns = runsThisShift(dep, key);
      return !depRuns.some((r) => r.status === "ok" || r.status === "needs_you");
    });
    if (unmetDep) {
      skipped.push({ division, reason: `waiting for ${unmetDep}` });
      continue;
    }
    if (cfg.skipIfIdle && !inboxHasWork(division)) {
      skipped.push({ division, reason: "no inbox work" });
      continue;
    }
    if (failed > 0 && !(sched.retryFailedOnce && failed < 2)) {
      skipped.push({ division, reason: "failed, retry budget spent" });
      continue;
    }
    due.push({ division, wake: cfg.wake, reason: failed > 0 ? "retry after failure" : "wake time reached" });
  }

  next.sort((a, b) => (a.wake < b.wake ? -1 : 1));
  return { due, skipped, next };
}

/**
 * Run one orchestration pass: wake every due division sequentially
 * (maxParallel: 1 keeps cost and load predictable through the night).
 */
export async function orchestrate(): Promise<{
  woke: Array<{ division: string; runId: number; decisions: number }>;
  failed: Array<{ division: string; error: string }>;
  skipped: Array<{ division: string; reason: string }>;
  next: Array<{ division: string; wake: string }>;
}> {
  const { due, skipped, next } = computeDue();
  const woke: Array<{ division: string; runId: number; decisions: number }> = [];
  const failed: Array<{ division: string; error: string }> = [];
  for (const d of due) {
    try {
      const r = await runDivision(d.division);
      woke.push({ division: d.division, ...r });
    } catch (err) {
      failed.push({ division: d.division, error: String(err).slice(0, 300) });
    }
  }
  return { woke, failed, skipped, next };
}
