import { NextRequest } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { getDb } from "@/lib/db";
import { getOfficeStatus } from "@/lib/status";
import { memberPath, memberWorkspace } from "@/lib/roster";
import { getUsage } from "@/lib/usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ID_OK = /^[a-z0-9-]+$/;
const MAX_FILES = 200;
const MAX_BYTES = 64 * 1024;

function listFiles(dir: string, base: string, out: Array<{ path: string; size: number; mtime: string }>): void {
  if (out.length >= MAX_FILES) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (e.name.startsWith(".")) continue;
    const full = path.join(dir, e.name);
    const rel = path.relative(base, full);
    if (e.isDirectory()) {
      listFiles(full, base, out);
    } else {
      try {
        const st = fs.statSync(full);
        out.push({ path: rel, size: st.size, mtime: st.mtime.toISOString() });
      } catch { /* raced */ }
    }
    if (out.length >= MAX_FILES) return;
  }
}

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id") ?? "";
  const file = req.nextUrl.searchParams.get("file");
  if (!ID_OK.test(id)) return Response.json({ ok: false, error: "bad id" }, { status: 400 });

  const root = memberPath(id);
  const workspace = memberWorkspace(id);
  if (!fs.existsSync(path.join(root, "SYSTEM.md"))) {
    return Response.json({ ok: false, error: "unknown member" }, { status: 404 });
  }

  // Single-file read (Folder tab). Confined to this member's workspace.
  if (file !== null) {
    const resolved = path.resolve(workspace, file);
    if (!resolved.startsWith(path.resolve(workspace) + path.sep)) {
      return Response.json({ ok: false, error: "outside workspace" }, { status: 403 });
    }
    let st: fs.Stats;
    try {
      st = fs.statSync(resolved);
      if (!st.isFile() || st.size > 4 * 1024 * 1024) throw new Error("unreadable");
    } catch {
      return Response.json({ ok: false, error: "cannot read file" }, { status: 404 });
    }
    const buf = fs.readFileSync(resolved);
    const text = buf.slice(0, MAX_BYTES).toString("utf-8");
    return Response.json({ ok: true, path: file, size: st.size, truncated: st.size > MAX_BYTES, content: text });
  }

  const db = getDb();
  const runs = db
    .prepare("SELECT id, started_at, status, summary FROM runs WHERE division = ? ORDER BY id DESC LIMIT 10")
    .all(id) as Array<{ id: number; started_at: string; status: string; summary: string | null }>;
  const decisions = db
    .prepare("SELECT id, type, title, status, created_at FROM pending_decisions WHERE division = ? ORDER BY id DESC LIMIT 10")
    .all(id) as Array<{ id: number; type: string; title: string; status: string; created_at: string }>;
  let schedule: { wake: string | null; enabled: boolean; skipIfIdle: boolean; after: string[] } | null = null;
  try {
    const sched = JSON.parse(fs.readFileSync(path.join(process.cwd(), "agents", "schedule.json"), "utf-8")) as {
      members: Record<string, { wake: string | null; enabled: boolean; skipIfIdle: boolean; after: string[] }>;
    };
    schedule = sched.members[id] ?? null;
  } catch { /* no schedule */ }

  let systemHead = "";
  try {
    systemHead = fs.readFileSync(path.join(root, "SYSTEM.md"), "utf-8").split("\n").slice(0, 12).join("\n");
  } catch { /* ignore */ }

  const files: Array<{ path: string; size: number; mtime: string }> = [];
  listFiles(workspace, workspace, files);
  const inbox = files.filter((f) => f.path.startsWith("inbox/")).map((f) => f.path);

  let logTail: string | null = null;
  if (runs.length > 0) {
    try {
      const body = fs.readFileSync(path.join(process.cwd(), "data", "runs", `run-${runs[0].id}.log`), "utf-8");
      logTail = body.split("\n").slice(-30).join("\n").slice(-6000);
    } catch { /* no log */ }
  }

  const status = getOfficeStatus().divisions.find((d) => d.id === id) ?? null;
  let tokens30d = 0;
  let runs30d = 0;
  try {
    const u = getUsage("30d");
    const m = u.byMember.find((x) => x.division === id);
    if (m) { tokens30d = m.tokens; runs30d = m.runs; }
  } catch { /* usage unavailable */ }

  return Response.json({
    ok: true,
    id,
    name: status?.name ?? id,
    role: status?.role ?? "",
    state: status?.state ?? "asleep",
    provenance: status?.provenance ?? null,
    schedule,
    systemHead,
    files,
    inbox,
    decisions,
    runs,
    logTail,
    tokens30d,
    runs30d,
  });
}
