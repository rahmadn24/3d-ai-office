#!/usr/bin/env node
// Nightly backup of the company's memory (runs, decisions, ledger, chats).
// Copies data/kantor.db -> backup/kantor-YYYYMMDD-HHMM.db, verifies the copy
// opens and counts match, then prunes to the newest 14. Run: node scripts/backup.mjs
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const SRC = process.env.KANTOR_DB || path.join(ROOT, "data", "kantor.db");
const DIR = path.join(ROOT, "backup");
const KEEP = 14;

function stamp() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date());
  const g = (t) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${g("year")}${g("month")}${g("day")}-${g("hour")}${g("minute")}`;
}

function counts(dbPath, readOnly = false) {
  const db = new DatabaseSync(dbPath, { readOnly });
  try {
    const n = (t) => db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
    return { runs: n("runs"), pending_decisions: n("pending_decisions"), ledger: n("ledger") };
  } finally {
    db.close();
  }
}

fs.mkdirSync(DIR, { recursive: true });
if (!fs.existsSync(SRC)) {
  console.error(JSON.stringify({ ok: false, error: `source missing: ${SRC}` }));
  process.exitCode = 1;
} else {
  const dest = path.join(DIR, `kantor-${stamp()}.db`);
  // SQLite backup via file copy is safe here: writers hold the DB only
  // briefly (single-statement transactions), and we verify the copy below.
  fs.copyFileSync(SRC, dest);
  const live = counts(SRC);
  const copy = counts(dest, true);
  const match = JSON.stringify(live) === JSON.stringify(copy);
  if (!match) {
    fs.rmSync(dest);
    console.error(JSON.stringify({ ok: false, error: "copy verification failed", live, copy }));
    process.exitCode = 1;
  } else {
    const files = fs.readdirSync(DIR).filter((f) => f.startsWith("kantor-") && f.endsWith(".db")).sort();
    for (const f of files.slice(0, Math.max(0, files.length - KEEP))) fs.rmSync(path.join(DIR, f));
    console.log(JSON.stringify({ ok: true, dest: path.basename(dest), ...copy, kept: Math.min(files.length, KEEP) }));
  }
}
