import fs from "node:fs";
import path from "node:path";
import { getDb, getPresence } from "./db";
import { computeDue } from "./orchestrator";
import { listRoster, memberWorkspace } from "./roster";

export type AgentState = "asleep" | "working" | "needs_you" | "done";

/** Why the agent is in its current state — the evidence trail, not a guess. */
export interface Provenance {
  source: "run" | "pending" | "schedule" | "inbox" | "done" | "idle";
  label: string;
  detail: string;
  freshMin: number | null;
}

export interface DivisionStatus {
  id: string;
  division: string;
  name: string;
  role: string;
  state: AgentState;
  pending: number;
  lastRun: { id: number; status: string; started_at: string; summary: string | null } | null;
  provenance: Provenance;
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
  const { next, skipped } = computeDue();
  const divisions = listRoster().map((d, i) => {
    const lastRun = db
      .prepare("SELECT id, status, started_at, summary FROM runs WHERE division = ? ORDER BY id DESC LIMIT 1")
      .get(d.id) as { id: number; status: string; started_at: string; summary: string | null } | undefined;
    const pending = (
      db.prepare("SELECT COUNT(*) AS n FROM pending_decisions WHERE division = ? AND status = 'pending'").get(d.id) as {
        n: number;
      }
    ).n;
    const workspace = memberWorkspace(d.id);
    const hasilDir = path.join(workspace, "Hasil");
    const hasilFiles = fs.existsSync(hasilDir) ? fs.readdirSync(hasilDir).filter((f) => !f.startsWith(".")) : [];
    let inboxCount = 0;
    try {
      inboxCount = fs.readdirSync(path.join(workspace, "inbox")).filter((f) => !f.startsWith(".")).length;
    } catch { /* no inbox */ }

    const ageMin = lastRun ? (Date.now() - new Date(lastRun.started_at).getTime()) / 60000 : null;
    const freshMin = ageMin === null ? null : Math.max(0, Math.round(ageMin));

    let state: AgentState = "asleep";
    if (lastRun?.status === "running") {
      state = ageMin! < 45 ? "working" : "asleep";
    } else if (pending > 0 || lastRun?.status === "needs_you") {
      state = pending > 0 ? "needs_you" : "done";
    } else if (lastRun?.status === "ok" || lastRun?.status === "failed") {
      state = "done";
    }

    let provenance: Provenance;
    if (lastRun?.status === "running" && ageMin! < 45) {
      provenance = { source: "run", label: `jalan · run #${lastRun.id}`, detail: lastRun.summary ?? "", freshMin };
    } else if (pending > 0) {
      provenance = {
        source: "pending",
        label: `${pending} keputusan menunggumu`,
        detail: lastRun ? `run #${lastRun.id} · ${lastRun.status}` : "belum pernah bangun",
        freshMin,
      };
    } else if (lastRun?.status === "failed" && ageMin! < 12 * 60) {
      provenance = { source: "run", label: `run #${lastRun.id} gagal`, detail: lastRun.summary ?? "", freshMin };
    } else {
      const nx = next.find((n) => n.division === d.id);
      const sk = skipped.find((s) => s.division === d.id);
      if (nx) {
        provenance = { source: "schedule", label: `bangun ${nx.wake}`, detail: sk ? sk.reason : "", freshMin };
      } else if (inboxCount > 0) {
        provenance = { source: "inbox", label: `${inboxCount} file di inbox`, detail: lastRun ? `run #${lastRun.id} · ${lastRun.status}` : "belum pernah bangun", freshMin };
      } else if (lastRun && (lastRun.status === "ok" || lastRun.status === "needs_you")) {
        provenance = { source: "done", label: `selesai · run #${lastRun.id}`, detail: lastRun.summary ?? "", freshMin };
      } else {
        provenance = { source: "idle", label: "belum ada jadwal", detail: "", freshMin };
      }
    }

    return {
      ...d,
      state,
      pending,
      lastRun: lastRun ?? null,
      provenance,
      hasilFiles,
      color: PALETTE[i % PALETTE.length],
      place: getPresence(d.id),
    };
  });
  return { divisions, now: new Date().toISOString(), next, skipped };
}
