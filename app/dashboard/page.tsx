import { getDb, listDecisions } from "@/lib/db";
import DecisionsList from "./DecisionsList";

export const dynamic = "force-dynamic";

export default function Dashboard() {
  // node:sqlite rows have null prototypes — spread into plain objects
  // before crossing into the client component.
  const pending = listDecisions("pending").map((d) => ({ ...d }));
  const runs = getDb().prepare("SELECT * FROM runs ORDER BY id DESC LIMIT 10").all() as Array<{
    id: number;
    division: string;
    started_at: string;
    status: string;
    summary: string | null;
  }>;

  return (
    <main>
      <h1>Bangun, buka HP, tinggal mutusin.</h1>
      <p>
        <small>
          {pending.length} hal nunggu keputusan kamu. · <a href="/piutang">piutang</a> · <a href="/kantor">kantor 3D</a> · <a href="/ngobrol">ngobrol</a>
          Jalankan agen:{" "}
          <code>curl &quot;http://localhost:3000/api/cron/tick?agent=gilang&quot;</code>
        </small>
      </p>

      <h2>Butuh keputusan ({pending.length})</h2>
      <DecisionsList initial={pending} />

      <h2>Riwayat lembur</h2>
      {runs.length === 0 && <p><small>Belum ada run. Wake up Gilang dulu.</small></p>}
      {runs.map((r) => (
        <div className="card" key={r.id}>
          <span className="badge">{r.division}</span>
          <span className={`badge ${r.status === "needs_you" ? "needs" : r.status === "ok" ? "ok" : ""}`}>
            {r.status}
          </span>
          <small> #{r.id} · {new Date(r.started_at).toLocaleString("id-ID")}</small>
          {r.summary && <pre>{r.summary}</pre>}
        </div>
      ))}
    </main>
  );
}
