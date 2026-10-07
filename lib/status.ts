import fs from "node:fs";
import path from "node:path";
import { getDb, getPresence } from "./db";
import { computeDue } from "./orchestrator";
import { listRoster, memberWorkspace } from "./roster";

export type AgentState = "asleep" | "working" | "needs_you" | "done";

export interface DivisionStatus {
  id: string;
  division: string;
  name: string;
  role: string;
  state: AgentState;
  pending: number;
  lastRun: { status: string; started_at: string; summary: string | null } | null;
  hasilFiles: string[];
  color: string;
  place: string;
}

const PALETTE = ["#e07856", "#6aa8ff", "#7fd08a", "#d8b45a", "#b48ae0", "#5ad0c8", "#e08ab0", "#9ad05a", "#7a8ae0"];

export function listDivisions(): Array<{ id: string; name: string; role: string }> {
  // Kept for chat/tab callers: returns one entry PER MEMBER (id = member id).
  return listRoster().map((m) => ({ id: m.id, name: m.name, role: m.role }));
}

export function getOfficeStatus(): {
  divisions: DivisionStatus[];
  now: string;
  next: Array<{ division: string; wake: string }>;
  skipped: Array<{ division: string; reason: string }>;
} {
  const db = getDb();
  const divisions = listRoster().map((d, i) => {
    const lastRun = db
      .prepare("SELECT status, started_at, summary FROM runs WHERE division = ? ORDER BY id DESC LIMIT 1")
      .get(d.id) as { status: string; started_at: string; summary: string | null } | undefined;
    const pending = (
      db.prepare("SELECT COUNT(*) AS n FROM pending_decisions WHERE division = ? AND status = 'pending'").get(d.id) as {
        n: number;
      }
    ).n;
    const hasilDir = path.join(memberWorkspace(d.id), "Hasil");
    const hasilFiles = fs.existsSync(hasilDir) ? fs.readdirSync(hasilDir).filter((f) => !f.startsWith(".")) : [];

    let state: AgentState = "asleep";
    if (lastRun?.status === "running") {
      const ageMin = (Date.now() - new Date(lastRun.started_at).getTime()) / 60000;
      state = ageMin < 45 ? "working" : "asleep";
    } else if (pending > 0 || lastRun?.status === "needs_you") {
      state = pending > 0 ? "needs_you" : "done";
    } else if (lastRun?.status === "ok" || lastRun?.status === "failed") {
      state = "done";
    }

    return {
      ...d,
      state,
      pending,
      lastRun: lastRun ?? null,
      hasilFiles,
      color: PALETTE[i % PALETTE.length],
      place: getPresence(d.id),
    };
  });
  const { next, skipped } = computeDue();
  return { divisions, now: new Date().toISOString(), next, skipped };
}
