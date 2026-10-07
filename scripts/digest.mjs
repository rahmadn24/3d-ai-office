#!/usr/bin/env node
// 07:00 digest: ringkas keputusan pending + hasil semalam, kirim SEKALI via Telegram.
// Butuh: TELEGRAM_BOT_TOKEN dan TELEGRAM_CHAT_ID di environment (lihat .env.example).
// Cron (Aktifkan SETELAH bot dikonfigurasi — lihat cron/README.md).
import { DatabaseSync } from "node:sqlite";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const DB_PATH = process.env.KANTOR_DB || path.join(ROOT, "data", "kantor.db");
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT = process.env.TELEGRAM_CHAT_ID;

const db = new DatabaseSync(DB_PATH);
const pending = db.prepare("SELECT id, division, type, title, suggestion FROM pending_decisions WHERE status='pending' ORDER BY id").all();
const runs = db.prepare("SELECT division, status, summary FROM runs WHERE date(started_at) >= date('now','-1 day') ORDER BY id DESC LIMIT 60").all();
const seen = new Set();
const latest = runs.filter((r) => {
  if (seen.has(r.division)) return false;
  seen.add(r.division);
  return true;
}).slice(0, 9);
const short = (s) => String(s || "").replace(/\s+/g, " ").slice(0, 120);

const lines = ["🌙 *Ringkasan semalam — Kantor AI*", ""];
if (pending.length === 0) {
  lines.push("Tidak ada yang menunggu. Tim tidur nyenyak.");
} else {
  lines.push(`*${pending.length} hal butuh keputusan kamu:*`);
  for (const p of pending) {
    lines.push(`• [${p.division}] ${p.title}`);
    if (p.suggestion) lines.push(`  Saran: ${p.suggestion}`);
  }
}
lines.push("", "*Jadwal lembur (status terakhir per divisi):*");
for (const r of latest) lines.push(`• ${r.division}: ${r.status}${r.summary ? ` — ${short(r.summary)}` : ""}`);
lines.push("", "Buka dashboard untuk mutusin.");

const text = lines.join("\n");

if (!TOKEN || !CHAT) {
  console.log("[digest] TELEGRAM_* belum dikonfigurasi. Isi pesan:\n");
  console.log(text);
  process.exit(0);
}

const res = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ chat_id: CHAT, text, parse_mode: "Markdown" }),
});
console.log("[digest] telegram:", res.status);
if (!res.ok) console.log(await res.text());
