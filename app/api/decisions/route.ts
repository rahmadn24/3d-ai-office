import { NextRequest } from "next/server";
import { getDb, listDecisions, setDecision } from "@/lib/db";
import { executeDecision } from "@/lib/tools-gateway";
import type { Decision } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const pending = listDecisions("pending");
  const recent = getDb()
    .prepare("SELECT * FROM pending_decisions WHERE status != 'pending' ORDER BY id DESC LIMIT 20")
    .all() as unknown as Decision[];
  return Response.json({ pending, recent });
}

export async function POST(req: NextRequest) {
  const { id, action, note } = (await req.json()) as { id: number; action: string; note?: string };
  if (!id || !["approve", "reject"].includes(action)) {
    return Response.json({ ok: false, error: "need {id, action: approve|reject}" }, { status: 400 });
  }
  if (action === "reject") {
    setDecision(id, "rejected", note);
    return Response.json({ ok: true, status: "rejected" });
  }
  setDecision(id, "approved", note);
  const result = await executeDecision(id);
  return Response.json({ ok: result.ok, status: result.ok ? "executed" : "failed", message: result.message });
}
