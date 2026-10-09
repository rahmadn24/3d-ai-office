import { getDb, listDecisions } from "@/lib/db";
import { listDivisions } from "@/lib/status";
import Hub from "./Hub";

export const dynamic = "force-dynamic";

export default function Kantor() {
  const pending = listDecisions("pending").map((d) => ({ ...d }));
  const divisions = listDivisions().map((d) => ({ id: d.id, name: d.name, role: d.role }));
  const db = getDb();
  const rows = db
    .prepare("SELECT * FROM ledger WHERE kind = 'receivable' ORDER BY id DESC")
    .all() as Array<{ id: number; division: string; description: string; amount: number; ts: string; meta: string }>;
  const receivables = rows.map((r) => {
    let pdf = "";
    try { pdf = (JSON.parse(r.meta) as { pdf?: string }).pdf?.replace(/.*workspace\//, "") ?? ""; } catch { /* ignore */ }
    return { id: r.id, division: r.division, description: r.description, amount: r.amount, ts: r.ts, pdf };
  });
  const total = receivables.reduce((a, r) => a + r.amount, 0);
  const kasRows = db
    .prepare("SELECT * FROM ledger WHERE kind = 'kas' ORDER BY id DESC")
    .all() as Array<{ id: number; description: string; amount: number; ts: string; meta: string }>;
  const kas = kasRows.map((r) => {
    let m: { tanggal?: string; keterangan?: string; akun?: string; debit?: number; kredit?: number } = {};
    try { m = JSON.parse(r.meta); } catch { /* ignore */ }
    return {
      id: r.id,
      tanggal: m.tanggal ?? r.ts.slice(0, 10),
      keterangan: m.keterangan ?? r.description,
      akun: m.akun ?? "-",
      debit: m.debit ?? 0,
      kredit: m.kredit ?? 0,
      ts: r.ts,
    };
  });
  const kasTotal = kas.reduce((a, e) => a + e.debit, 0);
  const runs = db
    .prepare("SELECT id, division, started_at, status, summary FROM runs ORDER BY id DESC LIMIT 10")
    .all() as Array<{ id: number; division: string; started_at: string; status: string; summary: string | null }>;
  const failures = db
    .prepare("SELECT id, division, started_at, summary FROM runs WHERE status = 'failed' AND datetime(started_at) >= datetime('now', '-36 hours') ORDER BY id DESC")
    .all() as Array<{ id: number; division: string; started_at: string; summary: string | null }>;
  return <Hub pending={pending} divisions={divisions} receivables={receivables} total={total} runs={runs.map((r) => ({ ...r }))} kas={kas} kasTotal={kasTotal} failures={failures.map((r) => ({ ...r }))} />;
}
