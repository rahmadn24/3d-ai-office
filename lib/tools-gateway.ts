import { PDFDocument, StandardFonts } from "pdf-lib";
import fs from "node:fs";
import path from "node:path";
import { appendLedger, getDb, nextCounter, setDecision, type Decision } from "./db";

function rp(n: number): string {
  return "Rp" + n.toLocaleString("id-ID");
}

interface QuotePayload {
  kind: string;
  client: string;
  items: Array<{ name: string; price: number }>;
  total: number;
  brief?: string;
}

/**
 * Execute an APPROVED decision. This is the ONLY path that performs real
 * side effects. Throws on any verification failure.
 */
export async function executeDecision(id: number): Promise<{ ok: boolean; message: string }> {
  const db = getDb();
  const d = db.prepare("SELECT * FROM pending_decisions WHERE id = ?").get(id) as Decision | undefined;
  if (!d) return { ok: false, message: "decision not found" };
  if (d.status !== "approved") return { ok: false, message: `must be approved first (status=${d.status})` };

  try {
    if (d.division === "gilang" && d.type === "quote") {
      const msg = await executeQuote(d);
      setDecision(id, "executed", msg);
      return { ok: true, message: msg };
    }
    if (d.division === "dimas" && d.type === "publish") {
      const msg = executePublish(d);
      setDecision(id, "executed", msg);
      return { ok: true, message: msg };
    }
    if (d.division === "laras" && d.type === "ledger") {
      const msg = executeLedger(d);
      setDecision(id, "executed", msg);
      return { ok: true, message: msg };
    }
    setDecision(id, "executed", "no automated executor for this type — handled manually");
    return { ok: true, message: "marked executed (manual type)" };
  } catch (err) {
    const message = `EXEC FAILED: ${String(err).slice(0, 300)}`;
    setDecision(id, "failed", message);
    return { ok: false, message };
  }
}

async function executeQuote(d: Decision): Promise<string> {
  const payload = JSON.parse(d.payload) as QuotePayload;
  if (payload.kind !== "quote" || !payload.client || !Array.isArray(payload.items)) {
    throw new Error("bad quote payload");
  }

  // Deterministic verification: total must equal sum, prices must match pricelist.
  const pricelistPath = path.join(process.cwd(), "agents", "gilang", "workspace", "pricelist.json");
  const pricelist = JSON.parse(fs.readFileSync(pricelistPath, "utf-8")) as {
    items: Array<{ name: string; price: number }>;
  };
  const priceOf = new Map(pricelist.items.map((i) => [i.name, i.price]));
  let sum = 0;
  for (const item of payload.items) {
    const official = priceOf.get(item.name);
    if (official === undefined) throw new Error(`item not in pricelist: ${item.name}`);
    if (official !== item.price) throw new Error(`price mismatch for ${item.name}: ${item.price} != ${official}`);
    sum += item.price;
  }
  if (sum !== payload.total) throw new Error(`total mismatch: sum=${sum} != total=${payload.total}`);

  const ym = new Date().toISOString().slice(0, 7).replace("-", "");
  const seq = nextCounter(`quote-${ym}`);
  const number = `PNW-${ym}-${String(seq).padStart(3, "0")}`;

  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let y = 790;
  const line = (text: string, b = false, size = 12) => {
    page.drawText(text, { x: 60, y, font: b ? bold : font, size });
    y -= size + 8;
  };
  line("SURAT PENAWARAN HARGA", true, 16);
  line(`Nomor: ${number}`);
  line(`Tanggal: ${new Date().toLocaleDateString("id-ID")}`);
  line(`Kepada: ${payload.client}`);
  y -= 8;
  line("Rincian:", true);
  for (const item of payload.items) {
    line(`- ${item.name}: ${rp(item.price)}`);
  }
  y -= 4;
  line(`TOTAL: ${rp(sum)}`, true, 14);
  y -= 8;
  line("Harga sesuai daftar harga resmi.", false, 10);

  const outDir = path.join(process.cwd(), "agents", "gilang", "workspace", "Hasil", "approved");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `${number}.pdf`);
  fs.writeFileSync(outPath, await pdf.save());

  appendLedger({
    division: "gilang",
    kind: "receivable",
    description: `Penawaran ${number} untuk ${payload.client}`,
    amount: sum,
    meta: { decision: d.id, number, pdf: outPath },
  });

  return `PDF ${number} dibuat (${rp(sum)}), tercatat sebagai piutang`;
}

/** Terbitkan situs statis Dimas: salin situs/ -> public/terbit/<site>/ (read-only copy). */
function executePublish(d: Decision): string {
  const payload = JSON.parse(d.payload) as { kind: string; site: string };
  if (payload.kind !== "publish" || !payload.site || !/^[a-z0-9-]+$/.test(payload.site)) {
    throw new Error("bad publish payload (site must be [a-z0-9-])");
  }
  const src = path.join(process.cwd(), "agents", "dimas", "workspace", "situs");
  if (!fs.existsSync(path.join(src, "index.html"))) throw new Error("situs/index.html tidak ada — tidak ada yang diterbitkan");
  const dest = path.join(process.cwd(), "public", "terbit", payload.site);
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  for (const f of fs.readdirSync(src)) {
    if (f.startsWith(".")) continue;
    fs.copyFileSync(path.join(src, f), path.join(dest, f));
  }
  appendLedger({
    division: "dimas",
    kind: "publish",
    description: `Terbit ${payload.site}`,
    amount: 0,
    meta: { decision: d.id, url: `/terbit/${payload.site}/` },
  });
  return `Situs terbit di /terbit/${payload.site}/ (menunggu restart dev? tidak — langsung bisa dibuka)`;
}

/** Catat batch kas Laras: validasi akun + debit=kredit, append-only. */
function executeLedger(d: Decision): string {
  const payload = JSON.parse(d.payload) as {
    kind: string;
    entries: Array<{ tanggal: string; keterangan: string; akun: string; debit?: number; kredit?: number }>;
  };
  if (payload.kind !== "ledger" || !Array.isArray(payload.entries) || payload.entries.length === 0) {
    throw new Error("bad ledger payload");
  }
  const akunPath = path.join(process.cwd(), "agents", "laras", "shared", "akun.json");
  const akun = new Set(
    (JSON.parse(fs.readFileSync(akunPath, "utf-8")) as { akun: Array<{ kode: string }> }).akun.map((a) => a.kode),
  );
  let debit = 0;
  let kredit = 0;
  for (const e of payload.entries) {
    if (!e.tanggal || !e.keterangan) throw new Error("entri tanpa tanggal/keterangan");
    if (!akun.has(e.akun)) throw new Error(`akun tidak dikenal: ${e.akun}`);
    const hasD = typeof e.debit === "number" && e.debit > 0;
    const hasK = typeof e.kredit === "number" && e.kredit > 0;
    if (hasD === hasK) throw new Error(`entri harus tepat satu debit/kredit: ${e.keterangan}`);
    if (!Number.isInteger(hasD ? e.debit : e.kredit)) throw new Error(`nominal harus integer: ${e.keterangan}`);
    debit += e.debit ?? 0;
    kredit += e.kredit ?? 0;
  }
  if (debit !== kredit) throw new Error(`batch tidak seimbang: debit ${debit} != kredit ${kredit}`);
  for (const e of payload.entries) {
    appendLedger({
      division: "laras",
      kind: "kas",
      description: `${e.tanggal} ${e.keterangan} [${e.akun}]`,
      amount: e.debit ?? e.kredit ?? 0,
      meta: { decision: d.id, ...e },
    });
  }
  return `${payload.entries.length} entri kas dicatat (seimbang Rp${debit.toLocaleString("id-ID")})`;
}
