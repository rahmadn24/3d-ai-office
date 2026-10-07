import { NextRequest } from "next/server";
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { addChat, getSession, listChats, setPresence, setSession } from "@/lib/db";
import { memberWorkspace } from "@/lib/roster";
import { listDivisions } from "@/lib/status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MODEL = process.env.KANTOR_MODEL || "9router/oc/muse-spark-1.3-contributor-free";
const OPENCODE_BIN = process.env.OPENCODE_BIN || "/Users/macintoshhd/.opencode/bin/opencode";

/** Gerakan dari teks owner: "semua ke pantry", "rapat!", "balik ke meja", ... */
function detectMove(text: string): string | null {
  const t = text.toLowerCase();
  const verb = /(ke\s|kumpul|ngumpul|datang|pergi|pindah|balik|kembali|mampir|rapat|kembali\b)/.test(t);
  if (!verb) return null;
  if (/(meeting|rapat|ruang rapat)/.test(t)) return "meeting";
  if (/(pantry|kopi|ngopi|makan|minum|dapur)/.test(t)) return "pantry";
  if (/(musholla|mushola|sholat|salat|berdoa)/.test(t)) return "musholla";
  if (/(lounge|santai|sofa|istirahat|rebahan)/.test(t)) return "lounge";
  if (/(meja|balik|kembali|kerja)/.test(t)) return "desk";
  return null;
}

function runChat(cwd: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(OPENCODE_BIN, args, { cwd, timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(String(stderr || err.message).slice(0, 500)));
      else resolve(stdout);
    });
    try { child.stdin?.end(); } catch { /* ignore */ }
  });
}

/** Ngobrol dengan manajer divisi. Percakapan bersambung (session per divisi).
 *  Tugas dari owner yang jelas → agen menuliskannya sebagai inbox/tugas-*.md
 *  agar dikerjakan pada wake berikutnya. */
export async function GET(req: NextRequest) {
  const division = req.nextUrl.searchParams.get("division") ?? "";
  if (!listDivisions().some((d) => d.id === division)) {
    return Response.json({ ok: false, error: "unknown division" }, { status: 400 });
  }
  return Response.json({ ok: true, messages: listChats(division).map((m) => ({ ...m })) });
}

export async function POST(req: NextRequest) {
  const { division, text } = (await req.json()) as { division: string; text: string };
  if (!text?.trim()) {
    return Response.json({ ok: false, error: "need {division, text}" }, { status: 400 });
  }
  // Broadcast: tanya semua divisi sekaligus (paralel). Tanpa tulis inbox.
  if (division === "*") {
    const clean = text.trim();
    const moveTo = detectMove(clean);
    const replies = await Promise.all(
      listDivisions().map(async (d) => {
        try {
          const reply = await chatOne(d.id, moveTo ? `${clean} (Catatan sistem: owner memintamu pindah ke ${moveTo}; jawab bahwa kamu segera ke sana.)` : clean, false);
          return { division: d.id, name: d.name, ok: true as const, reply };
        } catch (err) {
          return { division: d.id, name: d.name, ok: false as const, reply: String(err).slice(0, 150) };
        }
      }),
    );
    if (moveTo) {
      for (const d of listDivisions()) setPresence(d.id, moveTo);
    }
    return Response.json({ ok: true, broadcast: true, replies, moved: moveTo });
  }
  if (!listDivisions().some((d) => d.id === division)) {
    return Response.json({ ok: false, error: "unknown division" }, { status: 400 });
  }
  try {
    const clean = text.trim();
    const moveTo = detectMove(clean);
    const reply = await chatOne(division, clean, true);
    if (moveTo) setPresence(division, moveTo);
    return Response.json({ ok: true, reply, moved: moveTo });
  } catch (err) {
    const msg = `maaf, aku gagal jawab (${String(err).slice(0, 150)}). Coba lagi ya.`;
    addChat(division, "agent", msg);
    return Response.json({ ok: false, reply: msg });
  }
}

async function chatOne(division: string, text: string, allowTasks: boolean): Promise<string> {
  addChat(division, "owner", text);

  const root = path.dirname(memberWorkspace(division));
  const workspace = memberWorkspace(division);
  // Builder works from the repo root (scaffolds new agent folders).
  const cwd = division === "builder" ? process.cwd() : workspace;
  const system = fs.readFileSync(path.join(root, "SYSTEM.md"), "utf-8");
  const history = listChats(division, 12)
    .map((m) => `${m.role === "owner" ? "Owner" : "Kamu"}: ${m.text}`)
    .join("\n");

  const taskRule = allowTasks
    ? "Kalau owner memberi TUGAS yang jelas, tulis sebagai file baru inbox/tugas-<slug>.md (isi: apa, untuk kapan, konteks chat) lalu konfirmasi satu kalimat bahwa tugas dicatat untuk shift berikutnya."
    : "Ini pesan broadcast ke SEMUA divisi: jawab saja, JANGAN tulis file apa pun.";
  const prompt = `${system}\n\n## Mode ngobrol (bukan shift malam)\nOwner sedang ngobrol langsung denganmu. Jawab SINGKAT (maks 5 kalimat), bahasa santai. Kamu boleh baca file workspace untuk menjawab. ${taskRule} Jangan tulis decisions.json. Jangan klaim mengeksekusi hal yang butuh persetujuan.\n\n## Riwayat\n${history}\n\nOwner: ${text}`;

  const args = ["run", "--format", "json", "--model", MODEL];
  const sid = getSession(division);
  if (sid) args.push("--session", sid);
  args.push(prompt);

  const stdout = await runChat(cwd, args, 150_000);
  const texts: string[] = [];
  let sessionId: string | null = null;
  for (const line of stdout.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("{")) continue;
    try {
      const ev = JSON.parse(t) as { sessionID?: string; part?: { text?: string } };
      if (!sessionId && typeof ev.sessionID === "string") sessionId = ev.sessionID;
      if (typeof ev.part?.text === "string" && ev.part.text.trim()) texts.push(ev.part.text);
    } catch { /* skip */ }
  }
  if (sessionId) setSession(division, sessionId);
  const reply = texts.length ? texts[texts.length - 1] : "(tidak ada jawaban — coba lagi)";
  addChat(division, "agent", reply);
  return reply;
}
