import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export default function Piutang() {
  const db = getDb();
  const rows = db
    .prepare("SELECT * FROM ledger WHERE kind = 'receivable' ORDER BY id DESC")
    .all() as Array<{ id: number; ts: string; division: string; description: string; amount: number; meta: string }>;
  const total = rows.reduce((a, r) => a + r.amount, 0);
  const rp = (n: number) => "Rp" + n.toLocaleString("id-ID");

  return (
    <main>
      <h1>Piutang <small>· dari buku kas Laras + penawaran Gilang</small></h1>
      <p><small><a href="/dashboard">← dashboard</a> · total terbuka: <strong>{rp(total)}</strong> dari {rows.length} catatan</small></p>
      {rows.length === 0 && <p><small>Belum ada piutang tercatat.</small></p>}
      {rows.map((r) => {
        let pdf = "";
        try { pdf = (JSON.parse(r.meta) as { pdf?: string }).pdf ?? ""; } catch { /* ignore */ }
        return (
          <div className="card" key={r.id}>
            <span className="badge">{r.division}</span>
            <strong>{r.description}</strong> — {rp(r.amount)}
            <br />
            <small>{new Date(r.ts).toLocaleString("id-ID")}</small>
            {pdf && <><br /><small>PDF: <code>{pdf.replace(/.*workspace\//, "")}</code></small></>}
          </div>
        );
      })}
    </main>
  );
}
