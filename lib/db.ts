import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

const DB_PATH =
  process.env.KANTOR_DB || path.join(process.cwd(), "data", "kantor.db");

let db: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (!db) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    db = new DatabaseSync(DB_PATH);
    db.exec(`
      CREATE TABLE IF NOT EXISTS runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        division TEXT NOT NULL,
        started_at TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'running',
        summary TEXT
      );
      CREATE TABLE IF NOT EXISTS pending_decisions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        division TEXT NOT NULL,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        detail TEXT NOT NULL DEFAULT '',
        suggestion TEXT NOT NULL DEFAULT '',
        payload TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL,
        decided_at TEXT,
        note TEXT
      );
      CREATE TABLE IF NOT EXISTS ledger (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts TEXT NOT NULL,
        division TEXT NOT NULL,
        kind TEXT NOT NULL,
        description TEXT NOT NULL,
        amount INTEGER NOT NULL DEFAULT 0,
        meta TEXT NOT NULL DEFAULT '{}'
      );
      CREATE TABLE IF NOT EXISTS counters (
        name TEXT PRIMARY KEY,
        value INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS chats (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        division TEXT NOT NULL,
        role TEXT NOT NULL,
        text TEXT NOT NULL,
        ts TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        division TEXT PRIMARY KEY,
        session_id TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS presence (
        division TEXT PRIMARY KEY,
        place TEXT NOT NULL DEFAULT 'desk',
        updated_at TEXT NOT NULL
      );
    `);
  }
  return db;
}

export interface Decision {
  id: number;
  division: string;
  type: string;
  title: string;
  detail: string;
  suggestion: string;
  payload: string;
  status: string;
  created_at: string;
  decided_at: string | null;
  note: string | null;
}

export function logRun(division: string): number {
  const r = getDb()
    .prepare("INSERT INTO runs (division, started_at, status) VALUES (?, ?, 'running')")
    .run(division, new Date().toISOString());
  return Number(r.lastInsertRowid);
}

export function finishRun(id: number, status: string, summary: string) {
  getDb()
    .prepare("UPDATE runs SET status = ?, summary = ? WHERE id = ?")
    .run(status, summary, id);
}

export function addDecision(
  division: string,
  d: { type: string; title: string; detail?: string; suggestion?: string; payload?: unknown },
): number {
  const r = getDb()
    .prepare(
      "INSERT INTO pending_decisions (division, type, title, detail, suggestion, payload, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)",
    )
    .run(
      division,
      d.type,
      d.title,
      d.detail ?? "",
      d.suggestion ?? "",
      JSON.stringify(d.payload ?? {}),
      new Date().toISOString(),
    );
  return Number(r.lastInsertRowid);
}

export function listDecisions(status?: string): Decision[] {
  const db = getDb();
  if (status) {
    return db
      .prepare("SELECT * FROM pending_decisions WHERE status = ? ORDER BY id DESC")
      .all(status) as unknown as Decision[];
  }
  return db.prepare("SELECT * FROM pending_decisions ORDER BY id DESC").all() as unknown as Decision[];
}

export function setDecision(id: number, status: string, note?: string) {
  getDb()
    .prepare("UPDATE pending_decisions SET status = ?, decided_at = ?, note = ? WHERE id = ?")
    .run(status, new Date().toISOString(), note ?? null, id);
}

/** Monotonic counter, e.g. nextCounter("quote-202610") -> 1, 2, 3... */
export function nextCounter(name: string): number {
  const db = getDb();
  db.prepare("INSERT INTO counters (name, value) VALUES (?, 0) ON CONFLICT(name) DO NOTHING").run(name);
  db.prepare("UPDATE counters SET value = value + 1 WHERE name = ?").run(name);
  const row = db.prepare("SELECT value FROM counters WHERE name = ?").get(name) as { value: number };
  return row.value;
}

export function appendLedger(entry: {
  division: string;
  kind: string;
  description: string;
  amount?: number;
  meta?: unknown;
}) {
  getDb()
    .prepare("INSERT INTO ledger (ts, division, kind, description, amount, meta) VALUES (?, ?, ?, ?, ?, ?)")
    .run(
      new Date().toISOString(),
      entry.division,
      entry.kind,
      entry.description,
      entry.amount ?? 0,
      JSON.stringify(entry.meta ?? {}),
    );
}

export interface ChatMsg {
  id: number;
  division: string;
  role: string;
  text: string;
  ts: string;
}

export function addChat(division: string, role: string, text: string) {
  getDb()
    .prepare("INSERT INTO chats (division, role, text, ts) VALUES (?, ?, ?, ?)")
    .run(division, role, text, new Date().toISOString());
}

export function listChats(division: string, limit = 60): ChatMsg[] {
  return getDb()
    .prepare("SELECT * FROM chats WHERE division = ? ORDER BY id DESC LIMIT ?")
    .all(division, limit)
    .reverse() as unknown as ChatMsg[];
}

export function getSession(division: string): string | null {
  const row = getDb().prepare("SELECT session_id FROM sessions WHERE division = ?").get(division) as {
    session_id: string;
  } | undefined;
  return row?.session_id ?? null;
}

export function setSession(division: string, sessionId: string) {
  getDb()
    .prepare("INSERT INTO sessions (division, session_id) VALUES (?, ?) ON CONFLICT(division) DO UPDATE SET session_id = excluded.session_id")
    .run(division, sessionId);
}

export function getPresence(division: string): string {
  const row = getDb().prepare("SELECT place FROM presence WHERE division = ?").get(division) as {
    place: string;
  } | undefined;
  return row?.place ?? "desk";
}

export function setPresence(division: string, place: string) {
  getDb()
    .prepare("INSERT INTO presence (division, place, updated_at) VALUES (?, ?, ?) ON CONFLICT(division) DO UPDATE SET place = excluded.place, updated_at = excluded.updated_at")
    .run(division, place, new Date().toISOString());
}
