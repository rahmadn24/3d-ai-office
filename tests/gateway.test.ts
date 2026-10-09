/** Guardrail tests: the money path. Every rupiah the agents move must pass
 *  through executeDecision, and the math must be deterministic — never
 *  estimated by the model. Run: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { executeDecision } from "../lib/tools-gateway";
import { getDb } from "../lib/db";

// --- fixture workspace (runs at file load, before any test) ---
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "kantor-gw-"));
process.chdir(ROOT);
fs.mkdirSync("agents/gilang/workspace", { recursive: true });
fs.mkdirSync("agents/laras/shared", { recursive: true });
fs.mkdirSync("agents/dimas/workspace/situs", { recursive: true });
fs.writeFileSync(
  "agents/gilang/workspace/pricelist.json",
  JSON.stringify({ items: [{ name: "Kemeja", price: 150000 }, { name: "Ongkir", price: 20000 }] }),
);
fs.writeFileSync(
  "agents/laras/shared/akun.json",
  JSON.stringify({ akun: [{ kode: "KAS" }, { kode: "PENDAPATAN" }] }),
);
fs.writeFileSync("agents/dimas/workspace/situs/index.html", "<h1>hexa</h1>");

function approve(division: string, type: string, payload: unknown): number {
  const r = getDb()
    .prepare(
      "INSERT INTO pending_decisions (division, type, title, detail, suggestion, payload, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'approved', ?)",
    )
    .run(division, type, "t", "", "", JSON.stringify(payload), new Date().toISOString());
  return Number(r.lastInsertRowid);
}
function statusOf(id: number): string {
  return (getDb().prepare("SELECT status FROM pending_decisions WHERE id = ?").get(id) as { status: string }).status;
}
function ledgerCount(): number {
  return (getDb().prepare("SELECT COUNT(*) AS n FROM ledger").get() as { n: number }).n;
}

// --- the gate itself ---

test("missing decision is refused", async () => {
  const r = await executeDecision(999999);
  assert.equal(r.ok, false);
  assert.match(r.message, /not found/);
});

test("pending (unapproved) decision is never executed", async () => {
  const id = Number(
    getDb()
      .prepare("INSERT INTO pending_decisions (division, type, title, status, created_at, payload) VALUES ('gilang','quote','t','pending',?,?)")
      .run(new Date().toISOString(), "{}").lastInsertRowid,
  );
  const before = ledgerCount();
  const r = await executeDecision(id);
  assert.equal(r.ok, false);
  assert.match(r.message, /must be approved first/);
  assert.equal(ledgerCount(), before);
});

// --- quotes: deterministic totals ---

const goodQuote = {
  kind: "quote",
  client: "Toko Maju",
  items: [{ name: "Kemeja", price: 150000 }, { name: "Ongkir", price: 20000 }],
  total: 170000,
};

test("correct quote executes: PDF + receivable ledger", async () => {
  const id = approve("gilang", "quote", goodQuote);
  const r = await executeDecision(id);
  assert.equal(r.ok, true);
  assert.equal(statusOf(id), "executed");
  const row = getDb().prepare("SELECT * FROM ledger WHERE kind = 'receivable' ORDER BY id DESC LIMIT 1").get() as {
    amount: number; description: string; meta: string;
  };
  assert.equal(row.amount, 170000);
  const pdf = (JSON.parse(row.meta) as { pdf: string }).pdf;
  assert.ok(pdf && fs.existsSync(pdf), "PDF must exist on disk");
});

test("quote total mismatch is rejected, nothing written", async () => {
  const before = ledgerCount();
  const id = approve("gilang", "quote", { ...goodQuote, total: 100000 });
  const r = await executeDecision(id);
  assert.equal(r.ok, false);
  assert.match(r.message, /total mismatch/);
  assert.equal(statusOf(id), "failed");
  assert.equal(ledgerCount(), before);
});

test("quote with off-pricelist item is rejected", async () => {
  const id = approve("gilang", "quote", {
    kind: "quote", client: "X",
    items: [{ name: "Pesawat", price: 999 }],
    total: 999,
  });
  const r = await executeDecision(id);
  assert.equal(r.ok, false);
  assert.match(r.message, /not in pricelist/);
});

test("quote with wrong item price is rejected", async () => {
  const id = approve("gilang", "quote", {
    kind: "quote", client: "X",
    items: [{ name: "Kemeja", price: 1 }],
    total: 1,
  });
  const r = await executeDecision(id);
  assert.equal(r.ok, false);
  assert.match(r.message, /price mismatch/);
});

// --- kas ledger: balanced double-entry ---

const balanced = {
  kind: "ledger",
  entries: [
    { tanggal: "2026-10-09", keterangan: "jual kemeja", akun: "KAS", debit: 150000 },
    { tanggal: "2026-10-09", keterangan: "jual kemeja", akun: "PENDAPATAN", kredit: 150000 },
  ],
};

test("balanced kas batch executes with exact rows", async () => {
  const id = approve("laras", "ledger", balanced);
  const before = ledgerCount();
  const r = await executeDecision(id);
  assert.equal(r.ok, true);
  assert.equal(statusOf(id), "executed");
  assert.equal(ledgerCount(), before + 2);
  const rows = getDb().prepare("SELECT * FROM ledger WHERE kind = 'kas' ORDER BY id DESC LIMIT 2").all() as Array<{
    amount: number; meta: string;
  }>;
  assert.deepEqual(rows.map((x) => x.amount).sort((a, b) => a - b), [150000, 150000]);
});

test("unbalanced kas batch is rejected, nothing appended", async () => {
  const before = ledgerCount();
  const id = approve("laras", "ledger", {
    kind: "ledger",
    entries: [
      { tanggal: "2026-10-09", keterangan: "a", akun: "KAS", debit: 100 },
      { tanggal: "2026-10-09", keterangan: "a", akun: "PENDAPATAN", kredit: 50 },
    ],
  });
  const r = await executeDecision(id);
  assert.equal(r.ok, false);
  assert.match(r.message, /tidak seimbang/);
  assert.equal(ledgerCount(), before);
});

test("kas entry with unknown account is rejected", async () => {
  const id = approve("laras", "ledger", {
    kind: "ledger",
    entries: [{ tanggal: "2026-10-09", keterangan: "x", akun: "SILUMAN", debit: 10 }],
  });
  const r = await executeDecision(id);
  assert.equal(r.ok, false);
  assert.match(r.message, /akun tidak dikenal/);
});

test("kas entry with both debit and kredit is rejected", async () => {
  const id = approve("laras", "ledger", {
    kind: "ledger",
    entries: [{ tanggal: "2026-10-09", keterangan: "x", akun: "KAS", debit: 10, kredit: 10 }],
  });
  const r = await executeDecision(id);
  assert.equal(r.ok, false);
  assert.match(r.message, /tepat satu debit\/kredit/);
});

// --- publish gate ---

test("valid publish copies the site and logs it", async () => {
  const id = approve("dimas", "publish", { kind: "publish", site: "hexa-test" });
  const r = await executeDecision(id);
  assert.equal(r.ok, true);
  assert.ok(fs.existsSync(path.join(ROOT, "public", "terbit", "hexa-test", "index.html")));
  const row = getDb().prepare("SELECT * FROM ledger WHERE kind = 'publish' ORDER BY id DESC LIMIT 1").get() as {
    description: string;
  };
  assert.match(row.description, /hexa-test/);
});

test("publish with bad site name is rejected (path traversal)", async () => {
  const id = approve("dimas", "publish", { kind: "publish", site: "../../etc" });
  const r = await executeDecision(id);
  assert.equal(r.ok, false);
  assert.match(r.message, /bad publish payload/);
});
