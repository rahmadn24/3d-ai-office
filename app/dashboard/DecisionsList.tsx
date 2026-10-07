"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { Decision } from "@/lib/db";

export default function DecisionsList({ initial }: { initial: Decision[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<number | null>(null);
  const [items, setItems] = useState(initial);
  const [synced, setSynced] = useState("");

  // Live: refresh pending cards so night-shift results appear without reload.
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch("/api/decisions");
        const data = await res.json();
        if (alive && Array.isArray(data.pending)) {
          setItems(data.pending);
          setSynced(new Date().toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
        }
      } catch { /* keep last */ }
    };
    load();
    const t = setInterval(load, 15000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  async function act(id: number, action: "approve" | "reject") {
    const note = action === "reject" ? window.prompt("Alasan revisi/tolak?") ?? undefined : undefined;
    setBusy(id);
    const res = await fetch("/api/decisions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, action, note }),
    });
    const data = await res.json();
    alert(data.message ?? data.status ?? data.error);
    setItems((xs) => xs.filter((x) => x.id !== id));
    setBusy(null);
    router.refresh();
  }

  if (items.length === 0) return (
    <div className="card" style={{ textAlign: "center" }}>
      <img src="/img/agent-bot.png" alt="agen sedang standby" style={{ width: 220, borderRadius: 12, opacity: 0.9 }} />
      <p><small>Shift berakhir. Tidak ada yang menunggu — selamat tidur. 🌙</small></p>
      {synced && <p><small><span className="live-dot" />diperbarui {synced}</small></p>}
    </div>
  );

  return (
    <>
      {synced && <p><small><span className="live-dot" />live · diperbarui {synced}</small></p>}
      {items.map((d) => (
        <div className="card" key={d.id}>
          <span className="badge">{d.division}</span>
          <span className="badge">{d.type}</span>
          <h3>{d.title}</h3>
          {d.detail && <pre>{d.detail}</pre>}
          {d.suggestion && <p><strong>Saran tim:</strong> {d.suggestion}</p>}
          <button disabled={busy === d.id} onClick={() => act(d.id, "approve")}>
            Setuju
          </button>
          <button disabled={busy === d.id} className="reject" onClick={() => act(d.id, "reject")}>
            Tolak / revisi
          </button>
        </div>
      ))}
    </>
  );
}
