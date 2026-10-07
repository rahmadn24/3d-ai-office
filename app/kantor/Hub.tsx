"use client";

import { useEffect, useState } from "react";
import OfficeView from "./OfficeView";
import DecisionsList from "../dashboard/DecisionsList";
import ChatBox from "../ngobrol/ChatBox";
import type { Decision } from "@/lib/db";

export interface Receivable {
  id: number;
  division: string;
  description: string;
  amount: number;
  ts: string;
  pdf: string;
}

type Tab = "dashboard" | "ngobrol" | "piutang";

export interface RunRow {
  id: number;
  division: string;
  started_at: string;
  status: string;
  summary: string | null;
}

export default function Hub({ pending, divisions, receivables, total, runs }: {
  pending: Decision[];
  divisions: Array<{ id: string; name: string; role: string }>;
  receivables: Receivable[];
  total: number;
  runs: RunRow[];
}) {
  const [tab, setTab] = useState<Tab>("dashboard");
  const [collapsed, setCollapsed] = useState(false);
  const rp = (n: number) => "Rp" + n.toLocaleString("id-ID");

  useEffect(() => {
    if (window.innerWidth < 1000) setCollapsed(true);
  }, []);

  useEffect(() => {
    const fn = (e: Event) => setTab((e as CustomEvent<Tab>).detail);
    window.addEventListener("kantor:tab", fn);
    return () => window.removeEventListener("kantor:tab", fn);
  }, []);

  return (
    <div style={{ position: "fixed", inset: 0, display: "flex", background: "#090a0f" }}>
      {/* 3D office fills the left */}
      <div style={{ position: "relative", flex: 1, minWidth: 0 }}>
        <OfficeView />
      </div>
      {/* command deck */}
      {collapsed ? (
        <button
          onClick={() => setCollapsed(false)}
          style={{ position: "absolute", right: 16, bottom: 16, zIndex: 70, margin: 0, borderRadius: 999, padding: "0.6rem 1.1rem" }}
        >
          ☰ deck · {pending.length} ⏳ · {total > 0 ? rp(total) : ""}
        </button>
      ) : (
      <aside style={{
        width: 400, flexShrink: 0, zIndex: 60, height: "100%", overflowY: "auto",
        background: "rgba(13,15,24,0.92)", backdropFilter: "blur(16px)",
        borderLeft: "1px solid rgba(255,255,255,0.08)", padding: "14px 16px",
      }}>
        <div style={{ display: "flex", gap: 6, marginBottom: 12, alignItems: "center" }}>
          {(["dashboard", "ngobrol", "piutang"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={tab === t ? {} : { background: "rgba(255,255,255,0.03)", color: "#F8FAFC", border: "1px solid rgba(255,255,255,0.08)", boxShadow: "none" }}
            >
              {t === "dashboard" ? `dashboard (${pending.length})` : t === "ngobrol" ? "ngobrol" : `piutang`}
            </button>
          ))}
          <span style={{ flex: 1 }} />
          <button onClick={() => setCollapsed(true)} title="minimize ke pojok" style={{ background: "transparent", border: "1px solid rgba(255,255,255,0.15)", color: "#aaa", boxShadow: "none", margin: 0, padding: "0.4rem 0.7rem" }}>—</button>
        </div>

        {tab === "dashboard" && (
          <>
            <h2 style={{ marginTop: 0 }}>Butuh keputusan</h2>
            <DecisionsList initial={pending} />
            <h2>Riwayat lembur</h2>
            {runs.length === 0 && <p><small>Belum ada run.</small></p>}
            {runs.map((r) => (
              <div className="card" key={r.id} style={{ padding: "0.6rem 0.8rem" }}>
                <span className="badge">{r.division}</span>
                <span className={`badge ${r.status === "needs_you" ? "needs" : r.status === "ok" ? "ok" : ""}`}>
                  {r.status}
                </span>
                <br />
                <small>#{r.id} · {new Date(r.started_at).toLocaleString("id-ID")}</small>
                {r.summary && <pre style={{ marginBottom: 0 }}>{r.summary}</pre>}
              </div>
            ))}
          </>
        )}

        {tab === "ngobrol" && (
          <>
            <h2 style={{ marginTop: 0 }}>Ngobrol</h2>
            <ChatBox divisions={divisions} />
          </>
        )}

        {tab === "piutang" && (
          <>
            <h2 style={{ marginTop: 0 }}>Piutang <small>· total {rp(total)}</small></h2>
            {receivables.length === 0 && <p><small>Belum ada piutang tercatat.</small></p>}
            {receivables.map((r) => (
              <div className="card" key={r.id}>
                <span className="badge">{r.division}</span>
                <strong>{r.description}</strong> — {rp(r.amount)}
                <br />
                <small>{new Date(r.ts).toLocaleString("id-ID")}</small>
                {r.pdf && <><br /><small>PDF: <code>{r.pdf}</code></small></>}
              </div>
            ))}
          </>
        )}
      </aside>
      )}
    </div>
  );
}
