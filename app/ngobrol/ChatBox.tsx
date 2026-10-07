"use client";

import { useEffect, useState } from "react";

interface Div {
  id: string;
  name: string;
  role: string;
}
interface Msg {
  id: number;
  role: string;
  text: string;
  ts: string;
}

export default function ChatBox({ divisions }: { divisions: Div[] }) {
  const [sel, setSel] = useState(divisions[0]?.id ?? "");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [place, setPlace] = useState("desk");

  async function load(d: string) {
    if (d === "*") { setMsgs([]); return; }
    const [c, p] = await Promise.all([
      fetch(`/api/chat?division=${d}`).then((r) => r.json()),
      fetch(`/api/presence?division=${d}`).then((r) => r.json()),
    ]);
    setMsgs(c.messages ?? []);
    setPlace(p.place ?? "desk");
  }

  useEffect(() => { if (sel) load(sel); }, [sel]);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setBusy(true);
    const stamp = new Date().toISOString();
    setMsgs((m) => [...m, { id: -Date.now(), role: "owner", text, ts: stamp }]);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ division: sel, text }),
      });
      const data = await res.json();
      if (data.broadcast) {
        const placeName: Record<string, string> = { meeting: "meeting room", lounge: "lounge", pantry: "pantry", desk: "meja" };
        const extra = data.moved
          ? [{ id: Date.now() - 1, role: "sys", text: `→ semua jalan ke ${placeName[data.moved] ?? data.moved} 🚶`, ts: stamp }]
          : [];
        setMsgs((m) => [...m, ...extra, ...(data.replies ?? []).map((r: { division: string; name: string; reply: string }, i: number) => ({
          id: Date.now() + i, role: "agent", text: `${r.name}: ${r.reply}`, ts: stamp,
        }))]);
      } else {
        if (data.moved) setPlace(data.moved);
        setMsgs((m) => [...m, { id: Date.now(), role: "agent", text: data.reply ?? "(gagal)", ts: new Date().toISOString() }]);
      }
    } finally {
      setBusy(false);
    }
  }

  async function move(to: string) {
    await fetch("/api/presence", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ division: sel, place: to }),
    });
    setPlace(to);
  }

  const name = sel === "*" ? "semua tim" : divisions.find((d) => d.id === sel)?.name ?? sel;
  const placeLabel: Record<string, string> = { desk: "di meja", meeting: "di meeting room", lounge: "di lounge", pantry: "di pantry", musholla: "di musholla" };

  return (
    <>
      <select
        value={sel}
        onChange={(e) => setSel(e.target.value)}
        style={{ width: "100%", marginBottom: 12, background: "#0D0F18", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 8, color: "#F8FAFC", padding: "0.6rem 0.8rem", fontSize: "0.95rem" }}
      >
        <option value="*">📢 Semua tim — broadcast</option>
        {divisions.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}{d.role ? ` — ${d.role}` : ""}
          </option>
        ))}
      </select>

      <div className="card">
        <p>
          <strong>{name}</strong>{" "}
          {sel !== "*" && (
            <>
              <span className="badge">{placeLabel[place] ?? place}</span>{" "}
              {(["desk", "meeting", "lounge", "pantry", "musholla"] as const).filter((p) => p !== place).map((p) => (
                <button key={p} onClick={() => move(p)} style={{ fontSize: "0.75rem", padding: "0.3rem 0.6rem", background: "rgba(255,255,255,0.03)", color: "#F8FAFC", border: "1px solid rgba(255,255,255,0.08)", boxShadow: "none" }}>
                  {p === "desk" ? "← meja" : p === "meeting" ? "→ meeting" : p === "lounge" ? "→ lounge" : p === "pantry" ? "→ pantry" : "→ musholla"}
                </button>
              ))}
            </>
          )}
          {sel === "*" && <span className="badge">broadcast ke semua divisi</span>}
        </p>
        <div style={{ minHeight: 200, maxHeight: 380, overflowY: "auto", marginBottom: 12 }}>
          {msgs.length === 0 && <p><small>Belum ada obrolan. Sapa {name} atau kasih tugas — tugas jelas dicatat ke inbox untuk shift berikutnya.</small></p>}
          {msgs.map((m) => (
            <div key={m.id} style={{ margin: "0.5rem 0", textAlign: m.role === "owner" ? "right" : "left" }}>
              <span style={{
                display: "inline-block", maxWidth: "85%", textAlign: "left",
                background: m.role === "owner" ? "rgba(0,240,255,0.12)" : "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: "0.4rem 0.7rem",
              }}>
                <small style={{ opacity: 0.6 }}>{m.role === "owner" ? "kamu" : name}</small>
                <br />{m.text}
              </span>
            </div>
          ))}
          {busy && <p><small>{name} sedang mikir… (bisa 1–2 menit)</small></p>}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
            placeholder={`Tulis ke ${name}…`}
            style={{ flex: 1, background: "#0D0F18", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, color: "#F8FAFC", padding: "0.55rem 0.8rem" }}
          />
          <button onClick={send} disabled={busy}>kirim</button>
        </div>
      </div>
    </>
  );
}
