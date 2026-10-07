#!/usr/bin/env node
// Standalone waker: runs one division (or a full orchestrated pass) WITHOUT
// the Next.js dev server, so file edits / hot reloads can never kill a shift.
// Usage: node scripts/wake.mjs [division]   (no arg = orchestrated pass)
// Cron:  */5 * * * * cd /path/to/karyawan-online && node scripts/wake.mjs >> data/wake.log 2>&1
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
process.chdir(ROOT);

const MODEL = process.env.KANTOR_MODEL || "9router/oc/muse-spark-1.3-contributor-free";
const OPENCODE = process.env.OPENCODE_BIN || "/Users/macintoshhd/.opencode/bin/opencode";
const DB_PATH = process.env.KANTOR_DB || path.join(ROOT, "data", "kantor.db");

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec(`CREATE TABLE IF NOT EXISTS runs (id INTEGER PRIMARY KEY AUTOINCREMENT, division TEXT NOT NULL, started_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'running', summary TEXT);
CREATE TABLE IF NOT EXISTS pending_decisions (id INTEGER PRIMARY KEY AUTOINCREMENT, division TEXT NOT NULL, type TEXT NOT NULL, title TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '', suggestion TEXT NOT NULL DEFAULT '', payload TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL, decided_at TEXT, note TEXT);
CREATE TABLE IF NOT EXISTS ledger (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, division TEXT NOT NULL, kind TEXT NOT NULL, description TEXT NOT NULL, amount INTEGER NOT NULL DEFAULT 0, meta TEXT NOT NULL DEFAULT '{}');
CREATE TABLE IF NOT EXISTS counters (name TEXT PRIMARY KEY, value INTEGER NOT NULL DEFAULT 0);`);

function sh(cmd, args, cwd, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = execFile(cmd, args, { cwd, timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(`exit ${err.code} signal ${err.signal}: ${String(stderr || err.message).slice(0, 2000)}`));
      else resolve(stdout);
    });
    try { child.stdin?.end(); } catch { /* ignore */ }
  });
}

function memberBase(id) {
  const i = id.indexOf("-");
  return i === -1 ? `agents/${id}` : `agents/${id.slice(0, i)}/members/${id.slice(i + 1)}`;
}
const memberWorkspace = (id) => path.join(ROOT, memberBase(id), "workspace");

async function wake(division) {
  const root = path.join(ROOT, memberBase(division));
  const workspace = memberWorkspace(division);
  if (!fs.existsSync(path.join(root, "SYSTEM.md"))) throw new Error(`unknown division: ${division}`);
  const runId = Number(db.prepare("INSERT INTO runs (division, started_at, status) VALUES (?, ?, 'running')").run(division, new Date().toISOString()).lastInsertRowid);
  const decisionsFile = path.join(workspace, "decisions.json");
  try { fs.rmSync(decisionsFile); } catch { /* absent ok */ }
  const system = fs.readFileSync(path.join(root, "SYSTEM.md"), "utf-8");
  const prompt = `${system}\n\n## Tugas malam ini\nKerjakan sesuai peranmu. Baca pricelist.json dan semua file di inbox/. Tulis proposal ke Hasil/. Tulis decisions.json (array, boleh kosong). Terakhir, balas dengan satu baris ringkasan untuk log.`;

  let stdout = "";
  const saveLog = (extra = "") => {
    try {
      fs.mkdirSync(path.join(ROOT, "data", "runs"), { recursive: true });
      fs.writeFileSync(path.join(ROOT, "data", "runs", `run-${runId}.log`), `$ opencode run --model ${MODEL}\n\n--- STDOUT ---\n${stdout.slice(-2000000)}\n\n--- EXTRA ---\n${String(extra).slice(-20000)}`);
    } catch { /* best effort */ }
  };

  try {
    stdout = await sh(OPENCODE, ["run", "--format", "json", "--model", MODEL, prompt], workspace, 1800000);
  } catch (err) {
    saveLog(err);
    db.prepare("UPDATE runs SET status='failed', summary=? WHERE id=?").run(`${String(err).slice(0, 300)} (log: data/runs/run-${runId}.log)`, runId);
    throw err;
  }

  let imported = 0, found = false;
  try {
    const parsed = JSON.parse(fs.readFileSync(decisionsFile, "utf-8"));
    if (Array.isArray(parsed)) {
      found = true;
      for (const d of parsed) {
        if (d && typeof d.title === "string" && typeof d.type === "string") {
          db.prepare("INSERT INTO pending_decisions (division, type, title, detail, suggestion, payload, status, created_at) VALUES (?,?,?,?,?,?,'pending',?)")
            .run(division, d.type, d.title, d.detail ?? "", d.suggestion ?? "", JSON.stringify(d.payload ?? {}), new Date().toISOString());
          imported++;
        }
      }
    }
  } catch { /* no decisions file */ }

  if (!found && stdout.includes('"type":"error"')) {
    const m = stdout.match(/"message":"((?:[^"\\]|\\.)*)"/);
    const msg = (m ? m[1] : "agent error, no decisions.json").slice(0, 300);
    saveLog();
    db.prepare("UPDATE runs SET status='failed', summary=? WHERE id=?").run(`${msg} (log: data/runs/run-${runId}.log)`, runId);
    throw new Error(msg);
  }

  db.prepare("UPDATE runs SET status=?, summary=? WHERE id=?").run(imported > 0 ? "needs_you" : "ok", `${imported} keputusan diminta`, runId);
  saveLog();
  return { runId, decisions: imported };
}

const rawArg = process.argv[2];
const arg = rawArg && !rawArg.startsWith("--") ? rawArg : undefined;
const force = process.argv.includes("--force");
try {
  if (arg && !force) {
    const r = await wake(arg);
    console.log(JSON.stringify({ ok: true, division: arg, ...r }));
  } else if (!arg && !force) {
    // Orchestrated passes respect the night window — prevents accidental
    // daytime wakes (each costs 10-20 min of tokens). Use --force to override.
    const wibHour = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Jakarta" })).getHours();
    if (wibHour >= 8 && wibHour < 22) {
      console.log(JSON.stringify({ ok: true, snoozed: true, reason: "outside night window (22:00-08:00 WIB), use --force to override" }));
      process.exit(0);
    }
    const sched = JSON.parse(fs.readFileSync(path.join(ROOT, "agents", "schedule.json"), "utf-8"));
    const out = { woke: [], failed: [], skipped: [] };
    for (const [division, cfg] of Object.entries(sched.members)) {
      if (!cfg.enabled || !cfg.wake) { out.skipped.push({ division, reason: "disabled" }); continue; }
      const done = db.prepare("SELECT 1 FROM runs WHERE division=? AND status IN ('ok','needs_you') AND date(started_at) >= date('now','-1 day')").get(division);
      if (done) continue;
      try { out.woke.push({ division, ...(await wake(division)) }); }
      catch (e) { out.failed.push({ division, error: String(e).slice(0, 200) }); }
    }
    console.log(JSON.stringify({ ok: true, ...out }));
  }
} catch (e) {
  console.error(JSON.stringify({ ok: false, error: String(e).slice(0, 500) }));
  process.exitCode = 1;
}
