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

export interface KasEntry {
  id: number;
  tanggal: string;
  keterangan: string;
  akun: string;
  debit: number;
  kredit: number;
  ts: string;
}

type Tab = "dashboard" | "ngobrol" | "piutang" | "kas" | "usage";

interface UsageData {
  range: string;
  runs: number;
  input: number;
  output: number;
  reasoning: number;
  cacheRead: number;
  byMember: Array<{ division: string; tokens: number; input: number; output: number; runs: number; share: number }>;
  rows: Array<{ id: number; division: string; started_at: string; total: number }>;
}

export interface RunRow {
  id: number;
  division: string;
  started_at: string;
  status: string;
  summary: string | null;
}

export default function Hub({ pending, divisions, receivables, total, runs, kas, kasTotal }: {
  pending: Decision[];
  divisions: Array<{ id: string; name: string; role: string }>;
  receivables: Receivable[];
  total: number;
  runs: RunRow[];
  kas: KasEntry[];
  kasTotal: number;
}) {
  const [tab, setTab] = useState<Tab>("dashboard");
  const [collapsed, setCollapsed] = useState(false);
  const [usage, setUsage] = useState<UsageData | null>(null);
  const [usageRange, setUsageRange] = useState("7d");
  const rp = (n: number) => "Rp" + n.toLocaleString("id-ID");
  const compact = (n: number) => n >= 1000000 ? `${(n / 1000000).toFixed(1)}jt` : n >= 1000 ? `${(n / 1000).toFixed(1)}rb` : `${n}`;

  useEffect(() => {
    if (tab !== "usage") return;
    let alive = true;
    setUsage(null);
    fetch(`/api/usage?range=${usageRange}`)
      .then((r) => r.json())
      .then((d) => { if (alive) setUsage(d); })
      .catch(() => { /* keep empty */ });
    return () => { alive = false; };
  }, [tab, usageRange]);

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
        <div style={{ display: "flex", gap: 6, marginBottom: 12, alignItems: "center", flexWrap: "wrap" }}>
          {(["dashboard", "ngobrol", "piutang", "kas", "usage"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={tab === t ? {} : { background: "rgba(255,255,255,0.03)", color: "#F8FAFC", border: "1px solid rgba(255,255,255,0.08)", boxShadow: "none" }}
            >
              {t === "dashboard" ? `dashboard (${pending.length})` : t === "ngobrol" ? "ngobrol" : t === "piutang" ? "piutang" : t === "kas" ? `kas` : `token`}
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

        {tab === "usage" && (
          <>
            <h2 style={{ marginTop: 0 }}>Token <small>· dari run log, bukan tebakan</small></h2>
            <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
              {(["24h", "7d", "30d"] as const).map((r) => (
                <button
                  key={r}
                  onClick={() => setUsageRange(r)}
                  style={usageRange === r ? { padding: "0.3rem 0.7rem", fontSize: "0.75rem" } : { background: "rgba(255,255,255,0.03)", color: "#F8FAFC", border: "1px solid rgba(255,255,255,0.08)", boxShadow: "none", padding: "0.3rem 0.7rem", fontSize: "0.75rem" }}
                >
                  {r === "24h" ? "24 jam" : r === "7d" ? "7 hari" : "30 hari"}
                </button>
              ))}
            </div>
            {!usage && <p><small>Menghitung…</small></p>}
            {usage && usage.runs === 0 && <p><small>Belum ada run tercatat di rentang ini.</small></p>}
            {usage && usage.runs > 0 && (
              <>
                <p><small>
                  Total <strong>{compact(usage.input + usage.output + usage.reasoning)}</strong> token ·{" "}
                  masuk {compact(usage.input)} · keluar {compact(usage.output)} ·{" "}
                  cache {compact(usage.cacheRead)} · {usage.runs} run
                </small></p>
                {usage.byMember.map((m) => (
                  <div className="card" key={m.division} style={{ padding: "0.5rem 0.8rem" }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span className="badge">{m.division}</span>
                      <small>{compact(m.tokens)} · {m.share}% · {m.runs} run</small>
                    </div>
                    <div style={{ height: 6, borderRadius: 3, background: "rgba(255,255,255,0.08)", marginTop: 6 }}>
                      <div style={{ height: "100%", borderRadius: 3, width: `${Math.max(2, m.share)}%`, background: "#00f0ff" }} />
                    </div>
                  </div>
                ))}
                <h2>Run terakhir</h2>
                {usage.rows.slice(0, 15).map((r) => (
                  <div className="card" key={r.id} style={{ padding: "0.4rem 0.8rem" }}>
                    <span className="badge">{r.division}</span>
                    <small>#{r.id} · {compact(r.total)} token · {new Date(r.started_at).toLocaleString("id-ID")}</small>
                  </div>
                ))}
                <p><small>Biaya: Rp0 — model free-tier, token adalah mata uangnya.</small></p>
              </>
            )}
          </>
        )}
        {tab === "kas" && (
          <>
            <h2 style={{ marginTop: 0 }}>Buku kas <small>· Laras · append-only</small></h2>
            {kas.length === 0 && <p><small>Belum ada entri kas. Laras bangun 04:00.</small></p>}
            {kas.map((e) => (
              <div className="card" key={e.id} style={{ padding: "0.6rem 0.8rem" }}>
                <span className="badge">{e.akun}</span>
                <span className="badge" style={e.debit > 0 ? { background: "rgba(16,185,129,0.1)", borderColor: "rgba(16,185,129,0.25)", color: "#10b981" } : { background: "rgba(239,68,68,0.1)", borderColor: "rgba(239,68,68,0.3)", color: "#ef4444" }}>
                  {e.debit > 0 ? `+${rp(e.debit)}` : `−${rp(e.kredit)}`}
                </span>
                <br />
                <small>{e.tanggal} · {e.keterangan}</small>
              </div>
            ))}
            {kas.length > 0 && (
              <p><small>
                Masuk: <strong>{rp(kasTotal)}</strong> · Keluar: <strong>{rp(kas.filter((e) => e.kredit > 0).reduce((a, e) => a + e.kredit, 0))}</strong>
              </small></p>
            )}
          </>
        )}
      </aside>
      )}
    </div>
  );
}
